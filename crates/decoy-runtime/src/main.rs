use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{OriginalUri, State};
use axum::http::{HeaderName, HeaderValue, Request, Response, StatusCode};
use axum::routing::any;
use clap::{Parser, Subcommand};
use decoy_runtime::config::{ServeCliOptions, ServeConfig};
use decoy_runtime::engine::{Controller, HttpRequest, ResolveOutcome};
use decoy_runtime::http::{BodyPlan, HttpResponsePlan, ResponsePlan, RuntimeConfig};
use decoy_runtime::schema::HttpMethod;
use decoy_runtime::startup::load_catalog_from_files;
use tokio::net::TcpListener;
use tokio::sync::RwLock;

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
    config: Option<PathBuf>,
    #[arg(long)]
    routes: Option<PathBuf>,
    #[arg(long)]
    collections: Option<PathBuf>,
    #[arg(long)]
    port: Option<u16>,
    #[arg(long)]
    collection: Option<String>,
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    match Cli::parse().command {
        Command::Serve(args) => serve(args).await?,
    }

    Ok(())
}

async fn serve(args: ServeArgs) -> Result<(), Box<dyn std::error::Error>> {
    let cwd = std::env::current_dir()?;
    let config = ServeConfig::from_options(
        ServeCliOptions {
            config_file: args.config,
            routes: args.routes,
            collections: args.collections,
            port: args.port,
            collection: args.collection,
        },
        &cwd,
    )?;
    let startup = load_catalog_from_files(
        &config.routes,
        &config.collections,
        RuntimeConfig::default(),
        config.collection.as_deref(),
    )?;

    let controller = Arc::new(RwLock::new(Controller::new(
        startup.catalog,
        startup.default_collection,
    )));
    let app = Router::new()
        .fallback(any(handle_request))
        .with_state(controller);
    let addr = SocketAddr::from(([127, 0, 0, 1], config.port));
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
    let path = uri.path().to_owned();
    let outcome = controller
        .read()
        .await
        .resolve_http(&session, &HttpRequest { method, path });

    match outcome {
        ResolveOutcome::Matched { plan, .. } => response_from_plan(plan),
        ResolveOutcome::Miss(miss) => {
            response_from_plan(ResponsePlan::fail_closed_miss(miss.reason))
        }
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
