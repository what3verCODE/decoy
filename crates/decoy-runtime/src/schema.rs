use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Transport {
    Http,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Route {
    pub id: String,
    pub transport: Transport,
    #[serde(rename = "match")]
    pub route_match: HttpRouteMatch,
    #[serde(default)]
    pub cases: BTreeMap<String, Case>,
}

impl Route {
    pub fn from_yaml(input: &str) -> Result<Self, ValidationError> {
        let route: Self = serde_yaml::from_str(input)?;
        route.validate()?;
        Ok(route)
    }

    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_id("route", &self.id)?;

        if self.cases.is_empty() {
            return Err(ValidationError::EmptyCases {
                route: self.id.clone(),
            });
        }

        for (case_id, case) in &self.cases {
            validate_id("case", case_id)?;

            if case.behaviors.is_empty() {
                return Err(ValidationError::EmptyBehaviors {
                    route: self.id.clone(),
                    case: case_id.clone(),
                });
            }

            for behavior_id in case.behaviors.keys() {
                validate_id("behavior", behavior_id)?;
            }
        }

        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HttpRouteMatch {
    pub method: HttpMethod,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Head,
    Options,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Case {
    #[serde(default, rename = "match")]
    pub case_match: Value,
    #[serde(default)]
    pub behaviors: BTreeMap<String, Behavior>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(try_from = "RawBehavior", into = "RawBehavior")]
pub enum Behavior {
    Response(ResponseBehavior),
}

impl Behavior {
    pub fn kind(&self) -> BehaviorKind {
        match self {
            Self::Response(_) => BehaviorKind::Response,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BehaviorKind {
    Response,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ResponseBehavior {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct RawBehavior {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    kind: Option<BehaviorKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    body: Option<Value>,
}

impl TryFrom<RawBehavior> for Behavior {
    type Error = ValidationError;

    fn try_from(raw: RawBehavior) -> Result<Self, Self::Error> {
        match raw.kind.unwrap_or(BehaviorKind::Response) {
            BehaviorKind::Response => Ok(Self::Response(ResponseBehavior {
                status: raw.status,
                headers: raw.headers,
                body: raw.body,
            })),
        }
    }
}

impl From<Behavior> for RawBehavior {
    fn from(value: Behavior) -> Self {
        match value {
            Behavior::Response(response) => Self {
                kind: Some(BehaviorKind::Response),
                status: response.status,
                headers: response.headers,
                body: response.body,
            },
        }
    }
}

#[derive(Debug, Error)]
pub enum ValidationError {
    #[error("failed to parse route yaml: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("{kind} id `{id}` cannot be empty")]
    EmptyId { kind: &'static str, id: String },
    #[error(
        "{kind} id `{id}` cannot contain `:` because collection addresses use route:case:behavior"
    )]
    IdContainsColon { kind: &'static str, id: String },
    #[error("route `{route}` must define at least one case")]
    EmptyCases { route: String },
    #[error("case `{route}:{case}` must define at least one behavior")]
    EmptyBehaviors { route: String, case: String },
}

fn validate_id(kind: &'static str, id: &str) -> Result<(), ValidationError> {
    if id.trim().is_empty() {
        return Err(ValidationError::EmptyId {
            kind,
            id: id.to_owned(),
        });
    }

    if id.contains(':') {
        return Err(ValidationError::IdContainsColon {
            kind,
            id: id.to_owned(),
        });
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    #[test]
    fn parses_http_route_case_behavior_schema() {
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
      success:
        status: 200
        body:
          id: "123"
"#,
        )
        .unwrap();

        assert_eq!(route.id, "get-user");
        assert_eq!(route.transport, Transport::Http);
        assert_eq!(route.route_match.path, "/users/{id}");
        assert_eq!(
            route.cases["user-123"].behaviors["success"].kind(),
            BehaviorKind::Response
        );
    }

    #[test]
    fn infers_response_behavior_kind() {
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
      success:
        status: 200
        body: ok
"#,
        )
        .unwrap();

        assert!(matches!(
            route.cases["user-123"].behaviors["success"],
            Behavior::Response(_)
        ));
    }

    #[test]
    fn rejects_colon_in_address_parts() {
        let error = Route::from_yaml(
            r#"
id: get:user
transport: http
match:
  method: GET
  path: /users/{id}
cases:
  any:
    behaviors:
      success:
        status: 200
"#,
        )
        .unwrap_err();

        assert!(matches!(
            error,
            ValidationError::IdContainsColon { kind: "route", .. }
        ));
    }
}
