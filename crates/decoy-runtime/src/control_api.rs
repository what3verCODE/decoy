use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::engine::{ControlError, Controller, SelectionSnapshot};

pub const CONTROL_PREFIX: &str = "/__decoy__";
pub const SESSION_HEADER: &str = "x-mock-session";
pub const DEFAULT_SESSION: &str = "default";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ControlApiRequest {
    pub method: String,
    pub path: String,
    pub headers: BTreeMap<String, String>,
    pub body: Option<String>,
}

impl ControlApiRequest {
    pub fn post(path: impl Into<String>, body: impl Into<String>) -> Self {
        Self {
            method: "POST".to_owned(),
            path: path.into(),
            headers: BTreeMap::new(),
            body: Some(body.into()),
        }
    }

    pub fn with_session(mut self, session: impl Into<String>) -> Self {
        self.headers
            .insert(SESSION_HEADER.to_owned(), session.into());
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ControlApiResponse {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: String,
}

impl ControlApiResponse {
    fn json(status: u16, value: impl Serialize) -> Self {
        Self {
            status,
            headers: BTreeMap::from([("content-type".to_owned(), "application/json".to_owned())]),
            body: serde_json::to_string(&value).expect("control response serializes"),
        }
    }
}

#[derive(Debug, Deserialize)]
struct UseCollectionBody {
    collection: String,
}

#[derive(Debug, Deserialize)]
struct UseRouteBody {
    route: String,
    #[serde(rename = "case")]
    case_id: String,
    behavior: String,
}

#[derive(Debug, Serialize)]
struct ControlErrorBody {
    error: String,
}

#[derive(Debug, Error)]
pub enum ControlApiError {
    #[error("control endpoint `{method} {path}` is not defined")]
    UnknownEndpoint { method: String, path: String },
    #[error("failed to parse control JSON body: {0}")]
    InvalidJson(#[from] serde_json::Error),
    #[error(transparent)]
    Control(#[from] ControlError),
}

impl ControlApiError {
    fn status(&self) -> u16 {
        match self {
            Self::UnknownEndpoint { .. } => 404,
            Self::InvalidJson(_) | Self::Control(_) => 400,
        }
    }
}

/// Handle the native HTTP Control API shape for the prototype runtime.
///
/// The endpoint decision is recorded in `docs/design/native-control-api-shape.md`.
/// Endpoints are command-shaped Controller verbs below [`CONTROL_PREFIX`]:
///
/// - `POST /__decoy__/control/useCollection` with `{ "collection": "..." }`
/// - `POST /__decoy__/control/useRoute` with `{ "route": "...", "case": "...", "behavior": "..." }`
/// - `POST /__decoy__/control/reset` with an empty or absent body
///
/// The target Session is selected with `x-mock-session`; absent or empty headers use the default
/// Session. Successful responses return the resulting Selection snapshot.
pub fn handle_control_request(
    controller: &mut Controller,
    request: ControlApiRequest,
) -> ControlApiResponse {
    match try_handle_control_request(controller, request) {
        Ok(selection) => ControlApiResponse::json(200, selection),
        Err(error) => ControlApiResponse::json(
            error.status(),
            ControlErrorBody {
                error: error.to_string(),
            },
        ),
    }
}

pub fn try_handle_control_request(
    controller: &mut Controller,
    request: ControlApiRequest,
) -> Result<SelectionSnapshot, ControlApiError> {
    let session = session_id(&request.headers);
    let route = route_key(&request.method, &request.path);

    match route.as_deref() {
        Some("POST /control/useCollection") => {
            let body: UseCollectionBody = parse_body(request.body)?;
            Ok(controller.try_use_collection(&session, body.collection)?)
        }
        Some("POST /control/useRoute") => {
            let body: UseRouteBody = parse_body(request.body)?;
            Ok(controller.try_use_route(&session, body.route, body.case_id, body.behavior)?)
        }
        Some("POST /control/reset") => Ok(controller.reset(&session)),
        _ => Err(ControlApiError::UnknownEndpoint {
            method: request.method,
            path: request.path,
        }),
    }
}

fn route_key(method: &str, path: &str) -> Option<String> {
    if !is_control_path(path) {
        return None;
    }
    let path = path.strip_prefix(CONTROL_PREFIX)?;
    Some(format!("{} {}", method.to_ascii_uppercase(), path))
}

pub fn is_control_path(path: &str) -> bool {
    path.strip_prefix(CONTROL_PREFIX)
        .is_some_and(|suffix| suffix.is_empty() || suffix.starts_with('/'))
}

fn parse_body<T: for<'de> Deserialize<'de>>(body: Option<String>) -> Result<T, serde_json::Error> {
    serde_json::from_str(body.as_deref().unwrap_or("{}"))
}

pub fn session_id(headers: &BTreeMap<String, String>) -> String {
    headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(SESSION_HEADER))
        .map(|(_, value)| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_SESSION)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;
    use crate::collections::CollectionsFile;
    use crate::engine::{Catalog, HttpRequest, ResolveOutcome};
    use crate::http::RuntimeConfig;
    use crate::schema::{HttpMethod, Route};

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
          ok: true
      missing:
        status: 404
        body:
          error: missing
"#,
        )
        .unwrap()
    }

    fn controller() -> Controller {
        Controller::new(
            Catalog::new(
                vec![route()],
                CollectionsFile::from_yaml(
                    r#"
- id: local
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
            "local",
        )
    }

    fn selected(controller: &Controller, session: &str) -> String {
        let ResolveOutcome::Matched { activation, .. } = controller.resolve_http(
            session,
            &HttpRequest {
                method: HttpMethod::Get,
                path: "/users/123".to_owned(),
            },
        ) else {
            panic!("expected match")
        };
        activation.address()
    }

    #[test]
    fn native_control_api_can_diverge_two_sessions_and_reset_one_independently() {
        let mut controller = controller();

        let a = handle_control_request(
            &mut controller,
            ControlApiRequest::post(
                "/__decoy__/control/useCollection",
                r#"{"collection":"not-found"}"#,
            )
            .with_session("a"),
        );
        assert_eq!(a.status, 200);
        assert_eq!(selected(&controller, "a"), "get-user:user-123:missing");
        assert_eq!(selected(&controller, "b"), "get-user:user-123:success");

        let b = handle_control_request(
            &mut controller,
            ControlApiRequest::post(
                "/__decoy__/control/useRoute",
                r#"{"route":"get-user","case":"user-123","behavior":"missing"}"#,
            )
            .with_session("b"),
        );
        assert_eq!(b.status, 200);
        assert_eq!(selected(&controller, "a"), "get-user:user-123:missing");
        assert_eq!(selected(&controller, "b"), "get-user:user-123:missing");

        let reset_b = handle_control_request(
            &mut controller,
            ControlApiRequest::post("/__decoy__/control/reset", "").with_session("b"),
        );
        assert_eq!(reset_b.status, 200);
        assert_eq!(selected(&controller, "a"), "get-user:user-123:missing");
        assert_eq!(selected(&controller, "b"), "get-user:user-123:success");
    }

    #[test]
    fn native_control_api_returns_clear_errors_for_bad_addresses() {
        let mut controller = controller();

        let missing_collection = handle_control_request(
            &mut controller,
            ControlApiRequest::post(
                "/__decoy__/control/useCollection",
                r#"{"collection":"ghost"}"#,
            ),
        );
        assert_eq!(missing_collection.status, 400);
        assert_eq!(
            missing_collection.body,
            r#"{"error":"unknown collection `ghost`"}"#
        );

        let missing_behavior = handle_control_request(
            &mut controller,
            ControlApiRequest::post(
                "/__decoy__/control/useRoute",
                r#"{"route":"get-user","case":"user-123","behavior":"ghost"}"#,
            ),
        );
        assert_eq!(missing_behavior.status, 400);
        assert_eq!(
            missing_behavior.body,
            r#"{"error":"unknown behavior `get-user:user-123:ghost`"}"#
        );
    }
}
