//! Decoy native runtime prototype.
//!
//! This crate starts with the portable route/case/behavior schema. The current
//! TypeScript implementation is prior art, not the semantic source of truth.

pub mod schema;

pub use schema::{Behavior, BehaviorKind, Case, HttpRouteMatch, Route, Transport, ValidationError};
