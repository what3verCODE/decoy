use std::collections::BTreeMap;
use std::fs;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::{OriginalUri, State};
use axum::http::{HeaderName, HeaderValue, Request, Response, StatusCode};
use axum::routing::any;
use clap::{Parser, Subcommand};
use decoy_runtime::collections::CollectionsFile;
use decoy_runtime::engine::{Catalog, Controller, HttpExecutionOutcome, HttpExecutionRequest};
use decoy_runtime::http::{
    BodyPlan, HttpResponsePlan, RequestMetadata, ResponsePlan, RuntimeConfig,
};
use decoy_runtime::http_forward::ForwardResponse;
use decoy_runtime::schema::{HttpMethod, PassthroughTarget, Route};
use thiserror::Error;
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use walkdir::WalkDir;

const DEFAULT_SESSION: &str = "__decoy_default_session__";
const SESSION_HEADER: &str = "x-mock-session";

#[derive(Debug, Parser)]
#[command(name = "decoy")]
#[command(about = "Decoy native runtime")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Serve(ServeArgs),
}

#[derive(Debug, Parser)]
struct ServeArgs {
    #[arg(long)]
    routes: PathBuf,
    #[arg(long)]
    collections: PathBuf,
    #[arg(long, default_value_t = 8080)]
    port: u16,
    #[arg(long)]
    collection: Option<String>,
    #[arg(long, value_name = "URL")]
    passthrough_base_url: Option<String>,
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), CliError> {
    match Cli::parse().command {
        Command::Serve(args) => serve(args).await,
    }
}

async fn serve(args: ServeArgs) -> Result<(), CliError> {
    let routes = load_routes(&args.routes)?;
    let collections = CollectionsFile::from_yaml(&fs::read_to_string(&args.collections)?)?;
    let startup_collection = match args.collection {
        Some(collection) => collection,
        None => collections
            .first_id()
            .ok_or(CliError::NoCollections)?
            .to_owned(),
    };

    if collections.get(&startup_collection).is_none() {
        return Err(CliError::MissingStartupCollection(startup_collection));
    }

    let catalog = Catalog::new(
        routes,
        collections,
        RuntimeConfig {
            passthrough: args
                .passthrough_base_url
                .map(|base_url| PassthroughTarget { base_url }),
        },
    )?;
    let controller = Arc::new(RwLock::new(Controller::new(catalog, startup_collection)));
    let app = Router::new()
        .fallback(any(handle_request))
        .with_state(controller);
    let addr = SocketAddr::from(([127, 0, 0, 1], args.port));
    let listener = TcpListener::bind(addr).await?;
    eprintln!("decoy serve listening on http://{}", listener.local_addr()?);

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;

    Ok(())
}

async fn handle_request(
    State(controller): State<Arc<RwLock<Controller>>>,
    OriginalUri(uri): OriginalUri,
    request: Request<Body>,
) -> Response<Body> {
    let session = request
        .headers()
        .get(SESSION_HEADER)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_SESSION)
        .to_owned();
    let method = match http_method(request.method()) {
        Some(method) => method,
        None => {
            return response_from_plan(ResponsePlan::fail_closed_miss("unsupported http method"));
        }
    };
    let headers = request_headers(request.headers());
    let metadata = RequestMetadata {
        original_base_url: original_base_url(&headers),
    };
    let body = match to_bytes(request.into_body(), usize::MAX).await {
        Ok(body) => body.to_vec(),
        Err(error) => {
            return json_response(
                StatusCode::BAD_REQUEST,
                serde_json::json!({ "error": format!("failed to read request body: {error}") }),
            );
        }
    };
    let controller = controller.read().await.clone();
    let outcome = controller
        .execute_http(
            &session,
            HttpExecutionRequest {
                method,
                path: uri.path().to_owned(),
                path_and_query: uri
                    .path_and_query()
                    .map(|path| path.as_str().to_owned())
                    .unwrap_or_else(|| uri.path().to_owned()),
                headers,
                body,
                metadata,
            },
        )
        .await;

    response_from_execution_outcome(outcome)
}

fn response_from_execution_outcome(outcome: HttpExecutionOutcome) -> Response<Body> {
    match outcome {
        HttpExecutionOutcome::Response { response, .. } => response_from_forward_response(response),
        HttpExecutionOutcome::ForwardingError { source, .. } => json_response(
            StatusCode::BAD_GATEWAY,
            serde_json::json!({
                "error": "passthrough forwarding failed",
                "detail": source.to_string(),
            }),
        ),
    }
}

fn response_from_plan(plan: ResponsePlan) -> Response<Body> {
    match plan {
        ResponsePlan::Response(response) => http_response(response),
        ResponsePlan::Passthrough(_) => response_from_plan(ResponsePlan::fail_closed_miss(
            "passthrough behavior is not implemented by native serve yet",
        )),
    }
}

fn response_from_forward_response(plan: ForwardResponse) -> Response<Body> {
    let mut response = Response::new(Body::from(plan.body));
    *response.status_mut() = StatusCode::from_u16(plan.status).unwrap_or(StatusCode::OK);

    for (name, value) in plan.headers {
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(name.as_bytes()),
            HeaderValue::from_str(&value),
        ) {
            response.headers_mut().insert(name, value);
        }
    }

    response
}

fn json_response(status: StatusCode, value: serde_json::Value) -> Response<Body> {
    let mut response = Response::new(Body::from(
        serde_json::to_vec(&value).expect("JSON response serializes"),
    ));
    *response.status_mut() = status;
    response.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    response
}

fn http_response(plan: HttpResponsePlan) -> Response<Body> {
    let body = match plan.body {
        Some(BodyPlan::Json(value)) => Body::from(serde_json::to_vec(&value).expect("json body")),
        Some(BodyPlan::Text(text)) => Body::from(text),
        None => Body::empty(),
    };
    let mut response = Response::new(body);
    *response.status_mut() = StatusCode::from_u16(plan.status).unwrap_or(StatusCode::OK);

    for (name, value) in plan.headers {
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(name.as_bytes()),
            HeaderValue::from_str(&value),
        ) {
            response.headers_mut().insert(name, value);
        }
    }

    response
}

fn request_headers(headers: &axum::http::HeaderMap) -> BTreeMap<String, String> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            Some((name.as_str().to_owned(), value.to_str().ok()?.to_owned()))
        })
        .collect()
}

fn original_base_url(headers: &BTreeMap<String, String>) -> Option<String> {
    headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("host"))
        .map(|(_, value)| format!("http://{value}"))
}

fn http_method(method: &axum::http::Method) -> Option<HttpMethod> {
    match *method {
        axum::http::Method::GET => Some(HttpMethod::Get),
        axum::http::Method::POST => Some(HttpMethod::Post),
        axum::http::Method::PUT => Some(HttpMethod::Put),
        axum::http::Method::PATCH => Some(HttpMethod::Patch),
        axum::http::Method::DELETE => Some(HttpMethod::Delete),
        axum::http::Method::HEAD => Some(HttpMethod::Head),
        axum::http::Method::OPTIONS => Some(HttpMethod::Options),
        _ => None,
    }
}

fn load_routes(root: &Path) -> Result<Vec<Route>, CliError> {
    let mut files = Vec::new();

    for entry in WalkDir::new(root) {
        let entry = entry?;
        if !entry.file_type().is_file() || !is_yaml(entry.path()) {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(root)
            .expect("walkdir entry under root")
            .components()
            .map(|component| component.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        files.push((relative, entry.path().to_owned()));
    }

    files.sort_by(|left, right| left.0.cmp(&right.0));

    let mut routes = Vec::new();
    let mut route_sources = BTreeMap::new();

    for (relative, path) in files {
        let route = Route::from_yaml(&fs::read_to_string(&path)?).map_err(|source| {
            CliError::RouteLoad {
                path: path.clone(),
                source,
            }
        })?;
        if let Some(first_path) = route_sources.insert(route.id.clone(), relative.clone()) {
            return Err(CliError::DuplicateRoute {
                id: route.id,
                first_path,
                second_path: relative,
            });
        }
        routes.push(route);
    }

    Ok(routes)
}

fn is_yaml(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| matches!(extension, "yaml" | "yml"))
}

#[derive(Debug, Error)]
enum CliError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Walkdir(#[from] walkdir::Error),
    #[error(transparent)]
    Collections(#[from] decoy_runtime::collections::CollectionError),
    #[error(transparent)]
    Catalog(#[from] decoy_runtime::engine::CatalogError),
    #[error("failed to load route `{}`: {source}", path.display())]
    RouteLoad {
        path: PathBuf,
        source: decoy_runtime::schema::ValidationError,
    },
    #[error("duplicate route id `{id}` in `{first_path}` and `{second_path}`")]
    DuplicateRoute {
        id: String,
        first_path: String,
        second_path: String,
    },
    #[error("collections file does not define any collections")]
    NoCollections,
    #[error("startup collection `{0}` was not found")]
    MissingStartupCollection(String),
}
