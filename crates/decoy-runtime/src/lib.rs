//! Decoy native runtime prototype.
//!
//! This crate starts with the portable route/case/behavior schema. The current
//! TypeScript implementation is prior art, not the semantic source of truth.

pub mod collections;
pub mod engine;
pub mod http;
pub mod schema;

pub use collections::{Activation, Collection, CollectionRouteRef, CollectionsFile};
pub use engine::{Catalog, HttpRequest, MissDiagnostic, ResolveOutcome};
pub use http::{HttpResponsePlan, PassthroughPlan, RequestMetadata, ResponsePlan, RuntimeConfig};
pub use schema::{Behavior, BehaviorKind, Case, HttpRouteMatch, Route, Transport, ValidationError};
