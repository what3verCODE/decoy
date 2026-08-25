use std::collections::BTreeMap;

use serde_json::Value;

use crate::schema::{Behavior, PassthroughTarget, Route};

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RuntimeConfig {
    pub passthrough: Option<PassthroughTarget>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RequestMetadata {
    pub original_base_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResponsePlan {
    Response(HttpResponsePlan),
    Passthrough(PassthroughPlan),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpResponsePlan {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: Option<BodyPlan>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BodyPlan {
    Json(Value),
    Text(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PassthroughPlan {
    pub base_url: Option<String>,
}

impl ResponsePlan {
    pub fn from_behavior(
        route: &Route,
        behavior: &Behavior,
        runtime: &RuntimeConfig,
        request: &RequestMetadata,
    ) -> Self {
        match behavior {
            Behavior::Response(response) => Self::Response(HttpResponsePlan {
                status: response.status.unwrap_or(200),
                headers: response_headers(&response.headers, response.body.as_ref()),
                body: response.body.clone().map(body_plan),
            }),
            Behavior::Passthrough(passthrough) => Self::Passthrough(PassthroughPlan {
                base_url: passthrough
                    .target
                    .as_ref()
                    .or(route.passthrough.as_ref())
                    .or(runtime.passthrough.as_ref())
                    .map(|target| target.base_url.clone())
                    .or_else(|| request.original_base_url.clone()),
            }),
        }
    }
}

fn response_headers(
    explicit_headers: &BTreeMap<String, String>,
    body: Option<&Value>,
) -> BTreeMap<String, String> {
    let mut headers = explicit_headers.clone();

    if should_default_json_content_type(body)
        && !headers
            .keys()
            .any(|key| key.eq_ignore_ascii_case("content-type"))
    {
        headers.insert("content-type".to_owned(), "application/json".to_owned());
    }

    headers
}

fn should_default_json_content_type(body: Option<&Value>) -> bool {
    matches!(body, Some(Value::Array(_) | Value::Object(_)))
}

fn body_plan(body: Value) -> BodyPlan {
    match body {
        Value::String(text) => BodyPlan::Text(text),
        value => BodyPlan::Json(value),
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;
    use crate::schema::Route;

    fn route_yaml(behavior: &str) -> String {
        format!(
            r#"
id: get-user
transport: http
match:
  method: GET
  path: /users/{{id}}
cases:
  user-123:
    behaviors:
      selected:
{behavior}
"#
        )
    }

    fn selected_behavior(route: &Route) -> &Behavior {
        &route.cases["user-123"].behaviors["selected"]
    }

    #[test]
    fn response_defaults_to_status_200_and_json_content_type_for_object_body() {
        let route = Route::from_yaml(&route_yaml(
            r#"
        body:
          ok: true
"#,
        ))
        .unwrap();

        let plan = ResponsePlan::from_behavior(
            &route,
            selected_behavior(&route),
            &RuntimeConfig::default(),
            &RequestMetadata::default(),
        );

        assert_eq!(
            plan,
            ResponsePlan::Response(HttpResponsePlan {
                status: 200,
                headers: BTreeMap::from([(
                    "content-type".to_owned(),
                    "application/json".to_owned()
                )]),
                body: Some(BodyPlan::Json(serde_json::json!({ "ok": true }))),
            })
        );
    }

    #[test]
    fn string_body_is_text_without_default_json_content_type() {
        let route = Route::from_yaml(&route_yaml(
            r#"
        status: 201
        body: hello
"#,
        ))
        .unwrap();

        let plan = ResponsePlan::from_behavior(
            &route,
            selected_behavior(&route),
            &RuntimeConfig::default(),
            &RequestMetadata::default(),
        );

        assert_eq!(
            plan,
            ResponsePlan::Response(HttpResponsePlan {
                status: 201,
                headers: BTreeMap::new(),
                body: Some(BodyPlan::Text("hello".to_owned())),
            })
        );
    }

    #[test]
    fn explicit_content_type_wins() {
        let route = Route::from_yaml(&route_yaml(
            r#"
        headers:
          Content-Type: application/problem+json
        body:
          error: nope
"#,
        ))
        .unwrap();

        let plan = ResponsePlan::from_behavior(
            &route,
            selected_behavior(&route),
            &RuntimeConfig::default(),
            &RequestMetadata::default(),
        );

        let ResponsePlan::Response(response) = plan else {
            panic!("expected response")
        };
        assert_eq!(
            response.headers,
            BTreeMap::from([(
                "Content-Type".to_owned(),
                "application/problem+json".to_owned()
            )])
        );
    }

    #[test]
    fn passthrough_target_uses_behavior_route_runtime_request_order() {
        let route = Route::from_yaml(
            r#"
id: get-user
transport: http
match:
  method: GET
  path: /users/{id}
passthrough:
  baseUrl: https://route.example.test
cases:
  user-123:
    behaviors:
      selected:
        kind: passthrough
        target:
          baseUrl: https://behavior.example.test
"#,
        )
        .unwrap();

        let plan = ResponsePlan::from_behavior(
            &route,
            selected_behavior(&route),
            &RuntimeConfig {
                passthrough: Some(PassthroughTarget {
                    base_url: "https://runtime.example.test".to_owned(),
                }),
            },
            &RequestMetadata {
                original_base_url: Some("https://request.example.test".to_owned()),
            },
        );

        assert_eq!(
            plan,
            ResponsePlan::Passthrough(PassthroughPlan {
                base_url: Some("https://behavior.example.test".to_owned())
            })
        );
    }

    #[test]
    fn passthrough_target_falls_back_to_request_metadata() {
        let route = Route::from_yaml(
            r#"
id: get-user
transport: http
match:
  method: GET
  path: /users/{id}
cases:
  user-123:
    behaviors:
      selected:
        kind: passthrough
"#,
        )
        .unwrap();

        let plan = ResponsePlan::from_behavior(
            &route,
            selected_behavior(&route),
            &RuntimeConfig::default(),
            &RequestMetadata {
                original_base_url: Some("https://request.example.test".to_owned()),
            },
        );

        assert_eq!(
            plan,
            ResponsePlan::Passthrough(PassthroughPlan {
                base_url: Some("https://request.example.test".to_owned())
            })
        );
    }
}
