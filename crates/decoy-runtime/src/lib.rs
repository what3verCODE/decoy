//! Decoy native runtime prototype.
//!
//! This crate starts with the portable route/case/behavior schema. The current
//! TypeScript implementation is prior art, not the semantic source of truth.

pub mod collections;
pub mod control_api;
pub mod engine;
pub mod http;
pub mod native_http;
pub mod schema;

pub use collections::{Activation, Collection, CollectionRouteRef, CollectionsFile};
pub use control_api::{
    CONTROL_PREFIX, ControlApiRequest, ControlApiResponse, DEFAULT_SESSION, SESSION_HEADER,
    handle_control_request, try_handle_control_request,
};
pub use engine::{
    Catalog, ControlError, Controller, HttpRequest, MissDiagnostic, ResolveOutcome,
    RouteOverrideSnapshot, Selection, SelectionSnapshot,
};
pub use http::{HttpResponsePlan, PassthroughPlan, RequestMetadata, ResponsePlan, RuntimeConfig};
pub use native_http::{NativeHttpError, NativeHttpRuntime, NativeHttpServer};
pub use schema::{Behavior, BehaviorKind, Case, HttpRouteMatch, Route, Transport, ValidationError};
