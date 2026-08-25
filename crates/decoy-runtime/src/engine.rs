use std::collections::BTreeMap;

use serde_json::Value;
use thiserror::Error;

use crate::collections::{Activation, CollectionError, CollectionsFile};
use crate::http::{RequestMetadata, ResponsePlan, RuntimeConfig};
use crate::schema::{Case, HttpMethod, Route};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpRequest {
    pub method: HttpMethod,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ResolveOutcome {
    Matched {
        activation: Activation,
        path_params: BTreeMap<String, String>,
        plan: ResponsePlan,
    },
    Miss(MissDiagnostic),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MissDiagnostic {
    pub collection: String,
    pub reason: String,
    pub checked: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Catalog {
    routes: BTreeMap<String, Route>,
    collections: CollectionsFile,
    runtime: RuntimeConfig,
}

impl Catalog {
    pub fn new(
        routes: Vec<Route>,
        collections: CollectionsFile,
        runtime: RuntimeConfig,
    ) -> Result<Self, CatalogError> {
        let mut by_id = BTreeMap::new();

        for route in routes {
            route.validate()?;
            if by_id.insert(route.id.clone(), route).is_some() {
                return Err(CatalogError::DuplicateRoute);
            }
        }

        Ok(Self {
            routes: by_id,
            collections,
            runtime,
        })
    }

    pub fn resolve_http(&self, collection_id: &str, request: &HttpRequest) -> ResolveOutcome {
        self.resolve_http_with_metadata(collection_id, request, &RequestMetadata::default())
    }

    pub fn resolve_http_with_metadata(
        &self,
        collection_id: &str,
        request: &HttpRequest,
        metadata: &RequestMetadata,
    ) -> ResolveOutcome {
        self.resolve_http_with_overrides(collection_id, request, &BTreeMap::new(), metadata)
    }

    fn resolve_http_with_overrides(
        &self,
        collection_id: &str,
        request: &HttpRequest,
        overrides: &BTreeMap<(String, String), String>,
        metadata: &RequestMetadata,
    ) -> ResolveOutcome {
        let mut activations = match self.collections.resolve(collection_id) {
            Ok(activations) => activations,
            Err(error) => {
                return ResolveOutcome::Miss(MissDiagnostic {
                    collection: collection_id.to_owned(),
                    reason: error.to_string(),
                    checked: Vec::new(),
                });
            }
        };

        for ((route, case), behavior) in overrides {
            activations.push(Activation {
                route: route.clone(),
                case: case.clone(),
                behavior: behavior.clone(),
            });
        }

        let mut checked = Vec::new();

        for activation in activations.iter().rev() {
            checked.push(activation.address());

            let Some(route) = self.routes.get(&activation.route) else {
                continue;
            };

            if route.route_match.method != request.method {
                continue;
            }

            let Some(path_params) = match_path(&route.route_match.path, &request.path) else {
                continue;
            };

            let Some(case) = route.cases.get(&activation.case) else {
                continue;
            };

            if !case_matches(case, &path_params) {
                continue;
            }

            let Some(behavior) = case.behaviors.get(&activation.behavior) else {
                continue;
            };

            return ResolveOutcome::Matched {
                activation: activation.clone(),
                path_params,
                plan: ResponsePlan::from_behavior(route, behavior, &self.runtime, metadata),
            };
        }

        ResolveOutcome::Miss(MissDiagnostic {
            collection: collection_id.to_owned(),
            reason: "no active route case matched request".to_owned(),
            checked,
        })
    }
}

fn case_matches(case: &Case, path_params: &BTreeMap<String, String>) -> bool {
    let Some(expected_path_params) = case.case_match.get("pathParams") else {
        return true;
    };

    let Value::Object(expected_path_params) = expected_path_params else {
        return false;
    };

    expected_path_params.iter().all(|(key, expected)| {
        path_params
            .get(key)
            .is_some_and(|actual| expected == actual || expected == "*")
    })
}

fn match_path(pattern: &str, actual: &str) -> Option<BTreeMap<String, String>> {
    let pattern_parts = split_path(pattern);
    let actual_parts = split_path(actual);

    if pattern_parts.len() != actual_parts.len() {
        return None;
    }

    let mut params = BTreeMap::new();

    for (pattern_part, actual_part) in pattern_parts.iter().zip(actual_parts) {
        if pattern_part.starts_with('{') && pattern_part.ends_with('}') {
            let name = &pattern_part[1..pattern_part.len() - 1];
            params.insert(name.to_owned(), actual_part.to_owned());
            continue;
        }

        if *pattern_part != actual_part {
            return None;
        }
    }

    Some(params)
}

fn split_path(path: &str) -> Vec<&str> {
    path.trim_matches('/')
        .split('/')
        .filter(|part| !part.is_empty())
        .collect()
}

#[derive(Debug, Error)]
pub enum CatalogError {
    #[error(transparent)]
    Validation(#[from] crate::schema::ValidationError),
    #[error("duplicate route id")]
    DuplicateRoute,
    #[error(transparent)]
    Collection(#[from] CollectionError),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Selection {
    collection: String,
    route_overrides: BTreeMap<(String, String), String>,
}

impl Selection {
    fn new(collection: impl Into<String>) -> Self {
        Self {
            collection: collection.into(),
            route_overrides: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Controller {
    catalog: Catalog,
    default_collection: String,
    sessions: BTreeMap<String, Selection>,
}

impl Controller {
    pub fn new(catalog: Catalog, default_collection: impl Into<String>) -> Self {
        Self {
            catalog,
            default_collection: default_collection.into(),
            sessions: BTreeMap::new(),
        }
    }

    pub fn use_collection(&mut self, session: &str, collection: impl Into<String>) {
        self.selection_mut(session).collection = collection.into();
    }

    pub fn use_route(
        &mut self,
        session: &str,
        route: impl Into<String>,
        case: impl Into<String>,
        behavior: impl Into<String>,
    ) {
        self.selection_mut(session)
            .route_overrides
            .insert((route.into(), case.into()), behavior.into());
    }

    pub fn reset(&mut self, session: &str) {
        self.sessions.remove(session);
    }

    pub fn resolve_http(&self, session: &str, request: &HttpRequest) -> ResolveOutcome {
        let selection = self.selection(session);
        self.catalog.resolve_http_with_overrides(
            &selection.collection,
            request,
            &selection.route_overrides,
            &RequestMetadata::default(),
        )
    }

    fn selection(&self, session: &str) -> Selection {
        self.sessions
            .get(session)
            .cloned()
            .unwrap_or_else(|| Selection::new(self.default_collection.clone()))
    }

    fn selection_mut(&mut self, session: &str) -> &mut Selection {
        self.sessions
            .entry(session.to_owned())
            .or_insert_with(|| Selection::new(self.default_collection.clone()))
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;
    use crate::collections::CollectionsFile;
    use crate::http::{BodyPlan, HttpResponsePlan, PassthroughPlan};
    use crate::schema::PassthroughTarget;

    fn get_user_route() -> Route {
        Route::from_yaml(
            r#"
id: get-user
transport: http
match:
  method: GET
  path: /users/{id}
passthrough:
  baseUrl: https://route.example.test
cases:
  any:
    match:
      pathParams:
        id: "*"
    behaviors:
      fallback:
        status: 200
        body:
          kind: fallback
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
      real:
        kind: passthrough
"#,
        )
        .unwrap()
    }

    fn catalog(collections: &str) -> Catalog {
        Catalog::new(
            vec![get_user_route()],
            CollectionsFile::from_yaml(collections).unwrap(),
            RuntimeConfig {
                passthrough: Some(PassthroughTarget {
                    base_url: "https://runtime.example.test".to_owned(),
                }),
            },
        )
        .unwrap()
    }

    #[test]
    fn golden_route_case_behavior_selection_prefers_last_matching_activation() {
        let catalog = catalog(
            r#"
- id: local
  routes:
    - get-user:user-123:missing
    - get-user:any:fallback
"#,
        );

        let outcome = catalog.resolve_http(
            "local",
            &HttpRequest {
                method: HttpMethod::Get,
                path: "/users/123".to_owned(),
            },
        );

        let ResolveOutcome::Matched {
            activation,
            path_params,
            plan,
        } = outcome
        else {
            panic!("expected match")
        };

        assert_eq!(activation.address(), "get-user:any:fallback");
        assert_eq!(path_params["id"], "123");
        assert_eq!(
            plan,
            ResponsePlan::Response(HttpResponsePlan {
                status: 200,
                headers: BTreeMap::from([(
                    "content-type".to_owned(),
                    "application/json".to_owned()
                )]),
                body: Some(BodyPlan::Json(serde_json::json!({ "kind": "fallback" }))),
            })
        );
    }

    #[test]
    fn golden_collection_inheritance_child_overrides_parent_selection() {
        let catalog = catalog(
            r#"
- id: base
  routes:
    - get-user:user-123:success

- id: not-found
  from: base
  routes:
    - get-user:user-123:missing
"#,
        );

        let outcome = catalog.resolve_http(
            "not-found",
            &HttpRequest {
                method: HttpMethod::Get,
                path: "/users/123".to_owned(),
            },
        );

        let ResolveOutcome::Matched { activation, .. } = outcome else {
            panic!("expected match")
        };
        assert_eq!(activation.address(), "get-user:user-123:missing");
    }

    #[test]
    fn golden_per_session_selection_is_isolated() {
        let mut controller = Controller::new(
            catalog(
                r#"
- id: local
  routes:
    - get-user:user-123:success

- id: not-found
  routes:
    - get-user:user-123:missing
"#,
            ),
            "local",
        );

        controller.use_collection("session-a", "not-found");

        let request = HttpRequest {
            method: HttpMethod::Get,
            path: "/users/123".to_owned(),
        };

        let ResolveOutcome::Matched {
            activation: session_a,
            ..
        } = controller.resolve_http("session-a", &request)
        else {
            panic!("expected session-a match")
        };
        let ResolveOutcome::Matched {
            activation: session_b,
            ..
        } = controller.resolve_http("session-b", &request)
        else {
            panic!("expected session-b match")
        };

        assert_eq!(session_a.address(), "get-user:user-123:missing");
        assert_eq!(session_b.address(), "get-user:user-123:success");
    }

    #[test]
    fn golden_control_verbs_use_collection_use_route_and_reset() {
        let mut controller = Controller::new(
            catalog(
                r#"
- id: local
  routes:
    - get-user:user-123:success

- id: not-found
  routes:
    - get-user:user-123:missing
"#,
            ),
            "local",
        );
        let request = HttpRequest {
            method: HttpMethod::Get,
            path: "/users/123".to_owned(),
        };

        controller.use_collection("session", "not-found");
        let ResolveOutcome::Matched { activation, .. } =
            controller.resolve_http("session", &request)
        else {
            panic!("expected useCollection match")
        };
        assert_eq!(activation.address(), "get-user:user-123:missing");

        controller.use_route("session", "get-user", "user-123", "success");
        let ResolveOutcome::Matched { activation, .. } =
            controller.resolve_http("session", &request)
        else {
            panic!("expected useRoute match")
        };
        assert_eq!(activation.address(), "get-user:user-123:success");

        controller.reset("session");
        let ResolveOutcome::Matched { activation, .. } =
            controller.resolve_http("session", &request)
        else {
            panic!("expected reset match")
        };
        assert_eq!(activation.address(), "get-user:user-123:success");
    }

    #[test]
    fn golden_passthrough_plan_uses_route_target_before_runtime_target() {
        let catalog = catalog(
            r#"
- id: local
  routes:
    - get-user:user-123:real
"#,
        );

        let outcome = catalog.resolve_http(
            "local",
            &HttpRequest {
                method: HttpMethod::Get,
                path: "/users/123".to_owned(),
            },
        );

        let ResolveOutcome::Matched { plan, .. } = outcome else {
            panic!("expected match")
        };
        assert_eq!(
            plan,
            ResponsePlan::Passthrough(PassthroughPlan {
                base_url: Some("https://route.example.test".to_owned())
            })
        );
    }

    #[test]
    fn golden_passthrough_plan_uses_behavior_target_before_route_target() {
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
    match:
      pathParams:
        id: "123"
    behaviors:
      real:
        kind: passthrough
        target:
          baseUrl: https://behavior.example.test
"#,
        )
        .unwrap();
        let catalog = Catalog::new(
            vec![route],
            CollectionsFile::from_yaml(
                r#"
- id: local
  routes:
    - get-user:user-123:real
"#,
            )
            .unwrap(),
            RuntimeConfig {
                passthrough: Some(PassthroughTarget {
                    base_url: "https://runtime.example.test".to_owned(),
                }),
            },
        )
        .unwrap();

        let ResolveOutcome::Matched { plan, .. } = catalog.resolve_http(
            "local",
            &HttpRequest {
                method: HttpMethod::Get,
                path: "/users/123".to_owned(),
            },
        ) else {
            panic!("expected match")
        };

        assert_eq!(
            plan,
            ResponsePlan::Passthrough(PassthroughPlan {
                base_url: Some("https://behavior.example.test".to_owned())
            })
        );
    }

    #[test]
    fn golden_passthrough_plan_uses_runtime_before_request_metadata() {
        let route = Route::from_yaml(
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
      real:
        kind: passthrough
"#,
        )
        .unwrap();
        let catalog = Catalog::new(
            vec![route],
            CollectionsFile::from_yaml(
                r#"
- id: local
  routes:
    - get-user:user-123:real
"#,
            )
            .unwrap(),
            RuntimeConfig {
                passthrough: Some(PassthroughTarget {
                    base_url: "https://runtime.example.test".to_owned(),
                }),
            },
        )
        .unwrap();

        let ResolveOutcome::Matched { plan, .. } = catalog.resolve_http_with_metadata(
            "local",
            &HttpRequest {
                method: HttpMethod::Get,
                path: "/users/123".to_owned(),
            },
            &RequestMetadata {
                original_base_url: Some("https://request.example.test".to_owned()),
            },
        ) else {
            panic!("expected match")
        };

        assert_eq!(
            plan,
            ResponsePlan::Passthrough(PassthroughPlan {
                base_url: Some("https://runtime.example.test".to_owned())
            })
        );
    }

    #[test]
    fn golden_passthrough_plan_falls_back_to_request_metadata() {
        let route = Route::from_yaml(
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
      real:
        kind: passthrough
"#,
        )
        .unwrap();
        let catalog = Catalog::new(
            vec![route],
            CollectionsFile::from_yaml(
                r#"
- id: local
  routes:
    - get-user:user-123:real
"#,
            )
            .unwrap(),
            RuntimeConfig::default(),
        )
        .unwrap();

        let ResolveOutcome::Matched { plan, .. } = catalog.resolve_http_with_metadata(
            "local",
            &HttpRequest {
                method: HttpMethod::Get,
                path: "/users/123".to_owned(),
            },
            &RequestMetadata {
                original_base_url: Some("https://request.example.test".to_owned()),
            },
        ) else {
            panic!("expected match")
        };

        assert_eq!(
            plan,
            ResponsePlan::Passthrough(PassthroughPlan {
                base_url: Some("https://request.example.test".to_owned())
            })
        );
    }

    #[test]
    fn golden_fail_closed_miss_contains_checked_addresses() {
        let catalog = catalog(
            r#"
- id: local
  routes:
    - get-user:user-123:success
"#,
        );

        let outcome = catalog.resolve_http(
            "local",
            &HttpRequest {
                method: HttpMethod::Get,
                path: "/users/456".to_owned(),
            },
        );

        assert_eq!(
            outcome,
            ResolveOutcome::Miss(MissDiagnostic {
                collection: "local".to_owned(),
                reason: "no active route case matched request".to_owned(),
                checked: vec!["get-user:user-123:success".to_owned()],
            })
        );

        let ResolveOutcome::Miss(miss) = outcome else {
            panic!("expected miss")
        };
        assert_eq!(
            ResponsePlan::fail_closed_miss(miss.reason),
            ResponsePlan::Response(HttpResponsePlan {
                status: 501,
                headers: BTreeMap::from([
                    ("x-mock-miss".to_owned(), "true".to_owned()),
                    ("content-type".to_owned(), "application/json".to_owned()),
                ]),
                body: Some(BodyPlan::Json(serde_json::json!({
                    "error": "no active route case matched request"
                }))),
            })
        );
    }
}
