use std::collections::{BTreeMap, BTreeSet};

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use thiserror::Error;

use crate::http::PassthroughPlan;
use crate::schema::HttpMethod;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForwardRequest {
    pub method: HttpMethod,
    pub path_and_query: String,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForwardResponse {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}

#[derive(Debug, Error)]
pub enum ForwardingError {
    #[error("passthrough behavior selected but no upstream target was resolved")]
    MissingTarget,
    #[error("invalid passthrough target URL `{url}`: {source}")]
    InvalidTargetUrl {
        url: String,
        #[source]
        source: url::ParseError,
    },
    #[error("invalid forwarded request header `{name}`")]
    InvalidRequestHeaderName {
        name: String,
        #[source]
        source: reqwest::header::InvalidHeaderName,
    },
    #[error("invalid forwarded request header `{name}` value")]
    InvalidRequestHeaderValue {
        name: String,
        #[source]
        source: reqwest::header::InvalidHeaderValue,
    },
    #[error("passthrough request failed: {0}")]
    Request(#[from] reqwest::Error),
}

const ALWAYS_STRIPPED_REQUEST_HEADERS: &[&str] = &[
    "host",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "content-length",
];

const STRIPPED_RESPONSE_HEADERS: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "content-length",
];

pub async fn forward_passthrough(
    plan: &PassthroughPlan,
    request: ForwardRequest,
) -> Result<ForwardResponse, ForwardingError> {
    let Some(base_url) = &plan.base_url else {
        return Err(ForwardingError::MissingTarget);
    };

    let url = target_url(base_url, &request.path_and_query)?;
    let client = reqwest::Client::new();
    let response = client
        .request(reqwest_method(&request.method), url)
        .headers(forwardable_request_headers(&request.headers)?)
        .body(request.body)
        .send()
        .await?;

    let status = response.status().as_u16();
    let headers = forwardable_response_headers(response.headers());
    let body = response.bytes().await?.to_vec();

    Ok(ForwardResponse {
        status,
        headers,
        body,
    })
}

fn target_url(base_url: &str, path_and_query: &str) -> Result<url::Url, ForwardingError> {
    let normalized_path = if path_and_query.starts_with('/') {
        path_and_query.to_owned()
    } else {
        format!("/{path_and_query}")
    };
    let joined = format!("{}{}", base_url.trim_end_matches('/'), normalized_path);
    url::Url::parse(&joined).map_err(|source| ForwardingError::InvalidTargetUrl {
        url: joined,
        source,
    })
}

fn reqwest_method(method: &HttpMethod) -> reqwest::Method {
    match method {
        HttpMethod::Get => reqwest::Method::GET,
        HttpMethod::Post => reqwest::Method::POST,
        HttpMethod::Put => reqwest::Method::PUT,
        HttpMethod::Patch => reqwest::Method::PATCH,
        HttpMethod::Delete => reqwest::Method::DELETE,
        HttpMethod::Head => reqwest::Method::HEAD,
        HttpMethod::Options => reqwest::Method::OPTIONS,
    }
}

fn forwardable_request_headers(
    headers: &BTreeMap<String, String>,
) -> Result<HeaderMap, ForwardingError> {
    let stripped = stripped_request_headers(headers);
    let mut out = HeaderMap::new();

    for (name, value) in headers {
        if stripped.contains(&name.to_ascii_lowercase()) {
            continue;
        }
        let header_name = HeaderName::from_bytes(name.as_bytes()).map_err(|source| {
            ForwardingError::InvalidRequestHeaderName {
                name: name.clone(),
                source,
            }
        })?;
        let header_value = HeaderValue::from_str(value).map_err(|source| {
            ForwardingError::InvalidRequestHeaderValue {
                name: name.clone(),
                source,
            }
        })?;
        out.insert(header_name, header_value);
    }

    Ok(out)
}

fn stripped_request_headers(headers: &BTreeMap<String, String>) -> BTreeSet<String> {
    let mut stripped = ALWAYS_STRIPPED_REQUEST_HEADERS
        .iter()
        .map(|name| (*name).to_owned())
        .collect::<BTreeSet<_>>();

    for (name, value) in headers {
        if name.eq_ignore_ascii_case("connection") {
            for token in value.split(',') {
                let token = token.trim().to_ascii_lowercase();
                if !token.is_empty() {
                    stripped.insert(token);
                }
            }
        }
    }

    stripped
}

fn forwardable_response_headers(headers: &HeaderMap) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for (name, value) in headers {
        if STRIPPED_RESPONSE_HEADERS
            .iter()
            .any(|stripped| name.as_str().eq_ignore_ascii_case(stripped))
        {
            continue;
        }
        if let Ok(value) = value.to_str() {
            out.insert(name.as_str().to_owned(), value.to_owned());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::thread;

    use pretty_assertions::assert_eq;

    use super::*;

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
            let mut headers = BTreeMap::new();
            for line in lines {
                let (name, value) = line.split_once(':').unwrap();
                headers.insert(name.to_ascii_lowercase(), value.trim().to_owned());
            }
            let body = String::from_utf8_lossy(&buffer[header_end + 4..]).to_string();
            tx.send(CapturedRequest {
                request_line,
                headers,
                body,
            })
            .unwrap();

            stream
                .write_all(
                    b"HTTP/1.1 207 Multi-Status\r\ncontent-type: application/json\r\nx-from-upstream: yes\r\nconnection: close\r\ncontent-length: 11\r\n\r\n{\"ok\":true}",
                )
                .unwrap();
        });

        (format!("http://{addr}"), rx, handle)
    }

    #[tokio::test]
    async fn forwards_method_path_query_headers_and_body_to_resolved_target() {
        let (target, received, handle) = spawn_upstream();
        let response = forward_passthrough(
            &PassthroughPlan {
                base_url: Some(format!("{target}/")),
            },
            ForwardRequest {
                method: HttpMethod::Post,
                path_and_query: "/orders?page=2".to_owned(),
                headers: BTreeMap::from([
                    ("content-type".to_owned(), "application/json".to_owned()),
                    ("x-keep".to_owned(), "yes".to_owned()),
                    ("host".to_owned(), "decoy.local".to_owned()),
                    ("connection".to_owned(), "x-remove, keep-alive".to_owned()),
                    ("x-remove".to_owned(), "no".to_owned()),
                    ("content-length".to_owned(), "999".to_owned()),
                ]),
                body: br#"{"item":"x"}"#.to_vec(),
            },
        )
        .await
        .unwrap();

        assert_eq!(response.status, 207);
        assert_eq!(
            response.headers.get("x-from-upstream"),
            Some(&"yes".to_owned())
        );
        assert_eq!(response.headers.get("content-length"), None);
        assert_eq!(response.body, br#"{"ok":true}"#);

        let request = received.recv().unwrap();
        handle.join().unwrap();
        assert_eq!(request.request_line, "POST /orders?page=2 HTTP/1.1");
        assert_eq!(request.headers.get("x-keep"), Some(&"yes".to_owned()));
        assert_eq!(request.headers.get("x-remove"), None);
        assert_ne!(request.headers.get("host"), Some(&"decoy.local".to_owned()));
        assert_ne!(
            request.headers.get("content-length"),
            Some(&"999".to_owned())
        );
        assert_eq!(request.body, r#"{"item":"x"}"#);
    }

    #[tokio::test]
    async fn missing_target_is_forwarding_error() {
        let error = forward_passthrough(
            &PassthroughPlan { base_url: None },
            ForwardRequest {
                method: HttpMethod::Get,
                path_and_query: "/users/123".to_owned(),
                headers: BTreeMap::new(),
                body: Vec::new(),
            },
        )
        .await
        .unwrap_err();

        assert!(matches!(error, ForwardingError::MissingTarget));
    }

    #[tokio::test]
    async fn request_failure_is_forwarding_error() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        drop(listener);

        let error = forward_passthrough(
            &PassthroughPlan {
                base_url: Some(format!("http://{addr}")),
            },
            ForwardRequest {
                method: HttpMethod::Get,
                path_and_query: "/users/123".to_owned(),
                headers: BTreeMap::new(),
                body: Vec::new(),
            },
        )
        .await
        .unwrap_err();

        assert!(matches!(error, ForwardingError::Request(_)));
    }
}
