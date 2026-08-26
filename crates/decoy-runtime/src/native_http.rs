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
use crate::engine::{Controller, HttpExecutionOutcome, HttpExecutionRequest};
use crate::http::RequestMetadata;
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
                body: Some(String::from_utf8_lossy(&request.body).into_owned()),
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

    let path = request_path(&request.path);
    let metadata = RequestMetadata {
        original_base_url: original_base_url(&request.headers),
    };
    let controller = controller
        .lock()
        .expect("controller lock is not poisoned")
        .clone();
    let outcome = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime builds")
        .block_on(controller.execute_http(
            &session,
            HttpExecutionRequest {
                method,
                path,
                path_and_query: request.path,
                headers: request.headers,
                body: request.body,
                metadata,
            },
        ));

    response_from_execution_outcome(outcome)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WireRequest {
    method: String,
    path: String,
    headers: BTreeMap<String, String>,
    body: Vec<u8>,
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
        body,
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

fn response_from_execution_outcome(outcome: HttpExecutionOutcome) -> WireResponse {
    match outcome {
        HttpExecutionOutcome::Response { response, .. } => WireResponse {
            status: response.status,
            headers: response.headers,
            body: response.body,
        },
        HttpExecutionOutcome::ForwardingError { source, .. } => json_response(
            502,
            serde_json::json!({
                "error": "passthrough forwarding failed",
                "detail": source.to_string(),
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

fn request_path(path_and_query: &str) -> String {
    path_and_query
        .split_once('?')
        .map(|(path, _)| path)
        .unwrap_or(path_and_query)
        .to_owned()
}

fn original_base_url(headers: &BTreeMap<String, String>) -> Option<String> {
    headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("host"))
        .map(|(_, value)| format!("http://{value}"))
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
        502 => "Bad Gateway",
        501 => "Not Implemented",
        _ => "OK",
    }
}

#[cfg(test)]
mod tests {
    use std::net::{SocketAddr, TcpListener, TcpStream};
    use std::sync::mpsc;
    use std::thread;

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
        headers: BTreeMap<String, String>,
        body: String,
    }

    fn request(
        addr: SocketAddr,
        method: &str,
        path: &str,
        session: Option<&str>,
        body: &str,
    ) -> TestResponse {
        request_with_headers(addr, method, path, session, &[], body)
    }

    fn request_with_headers(
        addr: SocketAddr,
        method: &str,
        path: &str,
        session: Option<&str>,
        extra_headers: &[(&str, &str)],
        body: &str,
    ) -> TestResponse {
        let mut stream = TcpStream::connect(addr).unwrap();
        let session_header = session
            .map(|session| format!("x-mock-session: {session}\r\n"))
            .unwrap_or_default();
        let extra_headers = extra_headers
            .iter()
            .map(|(key, value)| format!("{key}: {value}\r\n"))
            .collect::<String>();
        write!(
            stream,
            "{method} {path} HTTP/1.1\r\nhost: localhost\r\n{session_header}{extra_headers}content-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        )
        .unwrap();

        let mut raw = String::new();
        stream.read_to_string(&mut raw).unwrap();
        let (head, body) = raw.split_once("\r\n\r\n").unwrap();
        let mut lines = head.lines();
        let status = lines
            .next()
            .unwrap()
            .split_whitespace()
            .nth(1)
            .unwrap()
            .parse()
            .unwrap();
        let headers = lines
            .filter_map(|line| {
                let (key, value) = line.split_once(':')?;
                Some((key.to_ascii_lowercase(), value.trim().to_owned()))
            })
            .collect();
        TestResponse {
            status,
            headers,
            body: body.to_owned(),
        }
    }

    #[derive(Debug)]
    struct CapturedRequest {
        request_line: String,
        headers: BTreeMap<String, String>,
        body: String,
    }

    fn spawn_upstream() -> (
        String,
        mpsc::Receiver<CapturedRequest>,
        thread::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = mpsc::channel();

        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = Vec::new();
            let mut chunk = [0; 1024];
            loop {
                let read = stream.read(&mut chunk).unwrap();
                if read == 0 {
                    break;
                }
                buffer.extend_from_slice(&chunk[..read]);
                if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
                    let text = String::from_utf8_lossy(&buffer);
                    let headers_end = text.find("\r\n\r\n").unwrap();
                    let head = &text[..headers_end];
                    let content_length = head
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    let body_start = headers_end + 4;
                    if buffer.len() >= body_start + content_length {
                        break;
                    }
                }
            }

            let header_end = buffer
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
                .unwrap();
            let head = String::from_utf8_lossy(&buffer[..header_end]);
            let mut lines = head.lines();
            let request_line = lines.next().unwrap().to_owned();
            let headers = lines
                .filter_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    Some((name.to_ascii_lowercase(), value.trim().to_owned()))
                })
                .collect();
            let body = String::from_utf8_lossy(&buffer[header_end + 4..]).to_string();
            tx.send(CapturedRequest {
                request_line,
                headers,
                body,
            })
            .unwrap();

            stream
                .write_all(
                    b"HTTP/1.1 202 Accepted\r\ncontent-type: text/plain\r\nx-upstream: yes\r\ncontent-length: 8\r\n\r\naccepted",
                )
                .unwrap();
        });

        (format!("http://{addr}"), rx, handle)
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
    fn selected_passthrough_is_forwarded_by_the_native_http_request_path() {
        let (upstream_url, captured, upstream) = spawn_upstream();
        let route = Route::from_yaml(&format!(
            r#"
id: create-user
transport: http
match:
  method: POST
  path: /users
cases:
  any:
    match: {{}}
    behaviors:
      forward:
        kind: passthrough
        target:
          baseUrl: {upstream_url}
"#
        ))
        .unwrap();
        let server = NativeHttpRuntime::new(Controller::new(
            Catalog::new(
                vec![route],
                CollectionsFile::from_yaml(
                    r#"
- id: forward
  routes:
    - create-user:any:forward
"#,
                )
                .unwrap(),
                RuntimeConfig::default(),
            )
            .unwrap(),
            "forward",
        ))
        .bind("127.0.0.1:0".parse::<SocketAddr>().unwrap())
        .unwrap();

        let response = request_with_headers(
            server.addr(),
            "POST",
            "/users?verbose=true",
            None,
            &[
                ("x-decoy-test", "yes"),
                ("Connection", "x-strip"),
                ("x-strip", "no"),
            ],
            r#"{"name":"Ada"}"#,
        );

        assert_eq!(response.status, 202);
        assert_eq!(response.headers.get("x-upstream"), Some(&"yes".to_owned()));
        assert_eq!(response.body, "accepted");
        let captured = captured.recv().unwrap();
        assert_eq!(captured.request_line, "POST /users?verbose=true HTTP/1.1");
        assert_eq!(
            captured.headers.get("x-decoy-test"),
            Some(&"yes".to_owned())
        );
        assert!(!captured.headers.contains_key("connection"));
        assert!(!captured.headers.contains_key("x-strip"));
        assert_eq!(captured.body, r#"{"name":"Ada"}"#);
        upstream.join().unwrap();
    }

    #[test]
    fn decoy_like_application_paths_are_not_captured_by_control_namespace() {
        let server = server();
        let addr = server.addr();

        let response = request(addr, "GET", "/__decoy__foo", None, "");

        assert_eq!(response.status, 501);
    }

    #[test]
    fn http_control_rejects_malformed_reset_json_without_mutating_selection() {
        let server = server();
        let addr = server.addr();

        let use_route = request(
            addr,
            "POST",
            "/__decoy__/control/useRoute",
            None,
            r#"{"route":"get-user","case":"user-123","behavior":"broken"}"#,
        );
        assert_eq!(use_route.status, 200);
        assert_eq!(request(addr, "GET", "/users/123", None, "").status, 500);

        let reset = request(addr, "POST", "/__decoy__/control/reset", None, "{");

        assert_eq!(reset.status, 400);
        assert!(reset.body.contains("failed to parse control JSON body"));
        assert_eq!(request(addr, "GET", "/users/123", None, "").status, 500);
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
