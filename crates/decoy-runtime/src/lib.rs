//! Decoy native runtime prototype.
//!
//! This crate starts with the portable route/case/behavior schema. The current
//! TypeScript implementation is prior art, not the semantic source of truth.

pub mod collections;
pub mod engine;
pub mod http;
pub mod schema;
pub mod startup;

pub use collections::{Activation, Collection, CollectionRouteRef, CollectionsFile};
pub use engine::{Catalog, Controller, HttpRequest, MissDiagnostic, ResolveOutcome, Selection};
pub use http::{HttpResponsePlan, PassthroughPlan, RequestMetadata, ResponsePlan, RuntimeConfig};
pub use schema::{Behavior, BehaviorKind, Case, HttpRouteMatch, Route, Transport, ValidationError};
pub use startup::{
    SourceLocation, Startup, StartupDiagnostic, StartupDiagnosticKind, StartupError,
    load_catalog_from_files,
};
