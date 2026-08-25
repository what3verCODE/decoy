use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::schema::{ValidationError, validate_id};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Collection {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(default)]
    pub routes: Vec<CollectionRouteRef>,
}

impl Collection {
    pub fn validate(&self) -> Result<(), CollectionError> {
        validate_id("collection", &self.id)?;

        if let Some(from) = &self.from {
            validate_id("collection parent", from)?;
        }

        for route_ref in &self.routes {
            route_ref.validate()?;
        }

        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CollectionRouteRef {
    Address(String),
    Structured {
        route: String,
        case: String,
        behavior: String,
    },
}

impl CollectionRouteRef {
    pub fn activation(&self) -> Result<Activation, CollectionError> {
        match self {
            Self::Address(address) => Activation::parse(address),
            Self::Structured {
                route,
                case,
                behavior,
            } => Activation::new(route.clone(), case.clone(), behavior.clone()),
        }
    }

    pub fn validate(&self) -> Result<(), CollectionError> {
        self.activation().map(|_| ())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Activation {
    pub route: String,
    pub case: String,
    pub behavior: String,
}

impl Activation {
    pub fn parse(address: &str) -> Result<Self, CollectionError> {
        let parts = address.split(':').collect::<Vec<_>>();
        if parts.len() != 3 {
            return Err(CollectionError::InvalidAddress {
                address: address.to_owned(),
            });
        }

        Self::new(
            parts[0].to_owned(),
            parts[1].to_owned(),
            parts[2].to_owned(),
        )
    }

    pub fn new(route: String, case: String, behavior: String) -> Result<Self, CollectionError> {
        validate_id("route", &route)?;
        validate_id("case", &case)?;
        validate_id("behavior", &behavior)?;

        Ok(Self {
            route,
            case,
            behavior,
        })
    }

    pub fn address(&self) -> String {
        format!("{}:{}:{}", self.route, self.case, self.behavior)
    }

    fn selection_key(&self) -> (&str, &str) {
        (&self.route, &self.case)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CollectionsFile {
    collections: BTreeMap<String, Collection>,
}

impl CollectionsFile {
    pub fn from_yaml(input: &str) -> Result<Self, CollectionError> {
        let collections = serde_yaml::from_str::<Vec<Collection>>(input)?;
        Self::new(collections)
    }

    pub fn new(collections: Vec<Collection>) -> Result<Self, CollectionError> {
        let mut by_id = BTreeMap::new();

        for collection in collections {
            collection.validate()?;

            if by_id.insert(collection.id.clone(), collection).is_some() {
                return Err(CollectionError::DuplicateCollection);
            }
        }

        Ok(Self { collections: by_id })
    }

    pub fn get(&self, id: &str) -> Option<&Collection> {
        self.collections.get(id)
    }

    pub fn resolve(&self, id: &str) -> Result<Vec<Activation>, CollectionError> {
        let mut visiting = BTreeSet::new();
        self.resolve_inner(id, &mut visiting)
    }

    fn resolve_inner(
        &self,
        id: &str,
        visiting: &mut BTreeSet<String>,
    ) -> Result<Vec<Activation>, CollectionError> {
        if !visiting.insert(id.to_owned()) {
            return Err(CollectionError::InheritanceCycle { id: id.to_owned() });
        }

        let collection = self
            .collections
            .get(id)
            .ok_or_else(|| CollectionError::UnknownCollection { id: id.to_owned() })?;

        let mut resolved = if let Some(parent) = &collection.from {
            self.resolve_inner(parent, visiting)?
        } else {
            Vec::new()
        };

        for route_ref in &collection.routes {
            let activation = route_ref.activation()?;
            resolved.retain(|existing| existing.selection_key() != activation.selection_key());
            resolved.push(activation);
        }

        visiting.remove(id);
        Ok(resolved)
    }
}

#[derive(Debug, Error)]
pub enum CollectionError {
    #[error("failed to parse collections yaml: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error(transparent)]
    Validation(#[from] ValidationError),
    #[error("collection route address `{address}` must use route:case:behavior")]
    InvalidAddress { address: String },
    #[error("duplicate collection id")]
    DuplicateCollection,
    #[error("unknown collection `{id}`")]
    UnknownCollection { id: String },
    #[error("collection inheritance cycle at `{id}`")]
    InheritanceCycle { id: String },
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    #[test]
    fn parses_string_and_structured_route_refs() {
        let collections = CollectionsFile::from_yaml(
            r#"
- id: local
  routes:
    - get-user:user-123:success
    - route: get-user
      case: user-456
      behavior: not-found
"#,
        )
        .unwrap();

        let resolved = collections.resolve("local").unwrap();
        assert_eq!(
            resolved.iter().map(Activation::address).collect::<Vec<_>>(),
            vec!["get-user:user-123:success", "get-user:user-456:not-found"]
        );
    }

    #[test]
    fn child_collection_overrides_parent_by_route_and_case() {
        let collections = CollectionsFile::from_yaml(
            r#"
- id: base
  routes:
    - get-user:any:success
    - get-user:user-123:success
    - list-users:any:success

- id: error-state
  from: base
  routes:
    - get-user:user-123:not-found
"#,
        )
        .unwrap();

        let resolved = collections.resolve("error-state").unwrap();
        assert_eq!(
            resolved.iter().map(Activation::address).collect::<Vec<_>>(),
            vec![
                "get-user:any:success",
                "list-users:any:success",
                "get-user:user-123:not-found"
            ]
        );
    }

    #[test]
    fn local_duplicate_keeps_last_activation_at_bottom() {
        let collections = CollectionsFile::from_yaml(
            r#"
- id: local
  routes:
    - get-user:user-123:success
    - get-user:user-123:not-found
"#,
        )
        .unwrap();

        let resolved = collections.resolve("local").unwrap();
        assert_eq!(
            resolved.iter().map(Activation::address).collect::<Vec<_>>(),
            vec!["get-user:user-123:not-found"]
        );
    }

    #[test]
    fn rejects_bad_address() {
        let error = CollectionsFile::from_yaml(
            r#"
- id: local
  routes:
    - get-user:user-123
"#,
        )
        .unwrap_err();

        assert!(matches!(error, CollectionError::InvalidAddress { .. }));
    }

    #[test]
    fn detects_inheritance_cycles() {
        let collections = CollectionsFile::from_yaml(
            r#"
- id: a
  from: b
- id: b
  from: a
"#,
        )
        .unwrap();

        let error = collections.resolve("a").unwrap_err();
        assert!(matches!(error, CollectionError::InheritanceCycle { .. }));
    }
}
