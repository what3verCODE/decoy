use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use thiserror::Error;

use crate::control_api::{self, ControlApiRequest, session_id};
use crate::engine::{Controller, HttpRequest, ResolveOutcome};
use crate::http::{BodyPlan, ResponsePlan};
use crate::schema::HttpMethod;

/// A small native HTTP adapter for the Rust runtime prototype.
///
/// Control requests mounted below `/__decoy__` mutate the same per-Session [`Controller`]
/// selection that normal HTTP requests resolve through, so callers can observe control effects over
/// the wire without an in-process test hook.
pub struct NativeHttpRuntime {
    controller: Arc<Mutex<Controller>>,
}

impl NativeHttpRuntime {
    pub fn new(controller: Controller) -> Self {
        Self {
            controller: Arc::new(Mutex::new(controller)),
        }
    }

    pub fn serve_once(&self, stream: TcpStream) -> Result<(), NativeHttpError> {
        serve_stream(stream, &self.controller)
    }

    pub fn bind(self, addr: impl Into<SocketAddr>) -> Result<NativeHttpServer, NativeHttpError> {
        let listener = TcpListener::bind(addr.into())?;
        listener.set_nonblocking(true)?;
        let addr = listener.local_addr()?;
        let controller = self.controller;
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let handle = thread::spawn(move || {
            while !thread_stop.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let controller = Arc::clone(&controller);
                        thread::spawn(move || {
                            let _ = serve_stream(stream, &controller);
                        });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });

        Ok(NativeHttpServer {
            addr,
            stop,
            handle: Some(handle),
        })
    }
}

pub struct NativeHttpServer {
    addr: SocketAddr,
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl NativeHttpServer {
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }
}

impl Drop for NativeHttpServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(self.addr);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

#[derive(Debug, Error)]
pub enum NativeHttpError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("invalid HTTP request: {0}")]
    BadRequest(String),
}

fn serve_stream(
    mut stream: TcpStream,
    controller: &Arc<Mutex<Controller>>,
) -> Result<(), NativeHttpError> {
    let request = read_request(&mut stream)?;
    let response = handle_request(controller, request);
    write_response(&mut stream, response)?;
    Ok(())
}

fn handle_request(controller: &Arc<Mutex<Controller>>, request: WireRequest) -> WireResponse {
    if control_api::is_control_path(&request.path) {
        let mut controller = controller.lock().expect("controller lock is not poisoned");
        let response = control_api::handle_control_request(
            &mut controller,
            ControlApiRequest {
                method: request.method,
                path: request.path,
                headers: request.headers,
                body: Some(request.body),
            },
        );
        return WireResponse {
            status: response.status,
            headers: response.headers,
            body: response.body.into_bytes(),
        };
    }

    let session = session_id(&request.headers);
    let Some(method) = parse_method(&request.method) else {
        return json_response(
            405,
            serde_json::json!({ "error": "unsupported HTTP method" }),
        );
    };

    let path = request
        .path
        .split_once('?')
        .map(|(path, _)| path)
        .unwrap_or(&request.path)
        .to_owned();

    let outcome = controller
        .lock()
        .expect("controller lock is not poisoned")
        .resolve_http(&session, &HttpRequest { method, path });

    match outcome {
        ResolveOutcome::Matched { plan, .. } => response_from_plan(plan),
        ResolveOutcome::Miss(miss) => {
            response_from_plan(ResponsePlan::fail_closed_miss(miss.reason))
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WireRequest {
    method: String,
    path: String,
    headers: BTreeMap<String, String>,
    body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WireResponse {
    status: u16,
    headers: BTreeMap<String, String>,
    body: Vec<u8>,
}

fn read_request(stream: &mut TcpStream) -> Result<WireRequest, NativeHttpError> {
    let mut reader = BufReader::new(stream);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line)? == 0 {
        return Err(NativeHttpError::BadRequest("empty request".to_owned()));
    }

    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| NativeHttpError::BadRequest("missing method".to_owned()))?
        .to_owned();
    let path = parts
        .next()
        .ok_or_else(|| NativeHttpError::BadRequest("missing path".to_owned()))?
        .to_owned();

    let mut headers = BTreeMap::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line)?;
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some((key, value)) = trimmed.split_once(':') {
            headers.insert(key.trim().to_owned(), value.trim().to_owned());
        }
    }

    let content_length = headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = vec![0; content_length];
    reader.read_exact(&mut body)?;

    Ok(WireRequest {
        method,
        path,
        headers,
        body: String::from_utf8_lossy(&body).into_owned(),
    })
}

fn write_response(stream: &mut TcpStream, response: WireResponse) -> Result<(), std::io::Error> {
    let reason = reason_phrase(response.status);
    write!(stream, "HTTP/1.1 {} {}\r\n", response.status, reason)?;
    for (key, value) in &response.headers {
        write!(stream, "{key}: {value}\r\n")?;
    }
    write!(
        stream,
        "content-length: {}\r\nconnection: close\r\n\r\n",
        response.body.len()
    )?;
    stream.write_all(&response.body)
}

fn response_from_plan(plan: ResponsePlan) -> WireResponse {
    match plan {
        ResponsePlan::Response(response) => {
            let body = match response.body {
                Some(BodyPlan::Json(value)) => {
                    serde_json::to_vec(&value).expect("JSON body serializes")
                }
                Some(BodyPlan::Text(text)) => text.into_bytes(),
                None => Vec::new(),
            };
            WireResponse {
                status: response.status,
                headers: response.headers,
                body,
            }
        }
        ResponsePlan::Passthrough(plan) => json_response(
            501,
            serde_json::json!({
                "error": "passthrough is not implemented by the native prototype HTTP adapter",
                "baseUrl": plan.base_url,
            }),
        ),
    }
}

fn json_response(status: u16, value: serde_json::Value) -> WireResponse {
    WireResponse {
        status,
        headers: BTreeMap::from([("content-type".to_owned(), "application/json".to_owned())]),
        body: serde_json::to_vec(&value).expect("JSON response serializes"),
    }
}

fn parse_method(method: &str) -> Option<HttpMethod> {
    match method.to_ascii_uppercase().as_str() {
        "GET" => Some(HttpMethod::Get),
        "POST" => Some(HttpMethod::Post),
        "PUT" => Some(HttpMethod::Put),
        "PATCH" => Some(HttpMethod::Patch),
        "DELETE" => Some(HttpMethod::Delete),
        "HEAD" => Some(HttpMethod::Head),
        "OPTIONS" => Some(HttpMethod::Options),
        _ => None,
    }
}

fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        501 => "Not Implemented",
        _ => "OK",
    }
}

#[cfg(test)]
mod tests {
    use std::net::{SocketAddr, TcpStream};

    use pretty_assertions::assert_eq;

    use super::*;
    use crate::collections::CollectionsFile;
    use crate::engine::Catalog;
    use crate::http::RuntimeConfig;
    use crate::schema::Route;

    fn route() -> Route {
        Route::from_yaml(
            r#"
id: get-user
transport: http
match:
  method: GET
  path: /users/{id}
cases:
  user-123:
    match:
      pathParams:
        id: "123"
    behaviors:
      success:
        status: 200
        body:
          id: "123"
      missing:
        status: 404
        body:
          error: missing
      broken:
        status: 500
        body:
          error: broken
"#,
        )
        .unwrap()
    }

    fn server() -> NativeHttpServer {
        NativeHttpRuntime::new(Controller::new(
            Catalog::new(
                vec![route()],
                CollectionsFile::from_yaml(
                    r#"
- id: happy
  routes:
    - get-user:user-123:success
- id: not-found
  routes:
    - get-user:user-123:missing
"#,
                )
                .unwrap(),
                RuntimeConfig::default(),
            )
            .unwrap(),
            "happy",
        ))
        .bind("127.0.0.1:0".parse::<SocketAddr>().unwrap())
        .unwrap()
    }

    struct TestResponse {
        status: u16,
        body: String,
    }

    fn request(
        addr: SocketAddr,
        method: &str,
        path: &str,
        session: Option<&str>,
        body: &str,
    ) -> TestResponse {
        let mut stream = TcpStream::connect(addr).unwrap();
        let session_header = session
            .map(|session| format!("x-mock-session: {session}\r\n"))
            .unwrap_or_default();
        write!(
            stream,
            "{method} {path} HTTP/1.1\r\nhost: localhost\r\n{session_header}content-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        )
        .unwrap();

        let mut raw = String::new();
        stream.read_to_string(&mut raw).unwrap();
        let (head, body) = raw.split_once("\r\n\r\n").unwrap();
        let status = head
            .lines()
            .next()
            .unwrap()
            .split_whitespace()
            .nth(1)
            .unwrap()
            .parse()
            .unwrap();
        TestResponse {
            status,
            body: body.to_owned(),
        }
    }

    #[test]
    fn http_control_verbs_mutate_only_targeted_session_and_reset_independently() {
        let server = server();
        let addr = server.addr();

        assert_eq!(
            request(addr, "GET", "/users/123", Some("a"), "").status,
            200
        );
        assert_eq!(
            request(addr, "GET", "/users/123", Some("b"), "").status,
            200
        );

        let use_collection = request(
            addr,
            "POST",
            "/__decoy__/control/useCollection",
            Some("a"),
            r#"{"collection":"not-found"}"#,
        );
        assert_eq!(use_collection.status, 200);
        assert_eq!(
            request(addr, "GET", "/users/123", Some("a"), "").status,
            404
        );
        assert_eq!(
            request(addr, "GET", "/users/123", Some("b"), "").status,
            200
        );

        let use_route = request(
            addr,
            "POST",
            "/__decoy__/control/useRoute",
            Some("b"),
            r#"{"route":"get-user","case":"user-123","behavior":"broken"}"#,
        );
        assert_eq!(use_route.status, 200);
        assert_eq!(
            request(addr, "GET", "/users/123", Some("a"), "").status,
            404
        );
        assert_eq!(
            request(addr, "GET", "/users/123", Some("b"), "").status,
            500
        );

        let reset_b = request(addr, "POST", "/__decoy__/control/reset", Some("b"), "");
        assert_eq!(reset_b.status, 200);
        assert_eq!(
            request(addr, "GET", "/users/123", Some("a"), "").status,
            404
        );
        assert_eq!(
            request(addr, "GET", "/users/123", Some("b"), "").status,
            200
        );
    }

    #[test]
    fn decoy_like_application_paths_are_not_captured_by_control_namespace() {
        let server = server();
        let addr = server.addr();

        let response = request(addr, "GET", "/__decoy__foo", None, "");

        assert_eq!(response.status, 501);
    }

    #[test]
    fn http_control_returns_clear_errors_for_invalid_addresses() {
        let server = server();
        let addr = server.addr();

        let collection = request(
            addr,
            "POST",
            "/__decoy__/control/useCollection",
            None,
            r#"{"collection":"ghost"}"#,
        );
        assert_eq!(collection.status, 400);
        assert_eq!(collection.body, r#"{"error":"unknown collection `ghost`"}"#);

        let behavior = request(
            addr,
            "POST",
            "/__decoy__/control/useRoute",
            None,
            r#"{"route":"get-user","case":"user-123","behavior":"ghost"}"#,
        );
        assert_eq!(behavior.status, 400);
        assert_eq!(
            behavior.body,
            r#"{"error":"unknown behavior `get-user:user-123:ghost`"}"#
        );
    }
}
