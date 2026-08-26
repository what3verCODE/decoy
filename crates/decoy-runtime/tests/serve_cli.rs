use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use tempfile::TempDir;

#[tokio::test]
async fn serve_loads_yaml_routes_collections_and_responds_over_http() {
    let fixture = Fixture::new();
    fixture.write_route(
        "z/fallback.yaml",
        r#"
id: users
transport: http
match:
  method: GET
  path: /users/{id}
cases:
  any:
    match:
      pathParams:
        id: "*"
    behaviors:
      fallback:
        status: 200
        headers:
          x-route: fallback
        body: fallback text
"#,
    );
    fixture.write_route(
        "a/user.yaml",
        r#"
id: users-by-id
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
        status: 201
        headers:
          x-route: user
        body:
          id: "123"
          name: Ada
      missing:
        status: 404
        body: nope
"#,
    );
    fixture.write_collections(
        r#"
- id: z-default
  routes:
    - users:any:fallback
    - users-by-id:user-123:success

- id: a-inherited
  from: z-default
  routes:
    - users-by-id:user-123:missing
"#,
    );

    let port = unused_port();
    let _server = fixture.spawn(port, &[]);
    wait_for_server(port).await;

    let response = reqwest::get(format!("http://127.0.0.1:{port}/users/123"))
        .await
        .unwrap();
    assert_eq!(response.status(), 201);
    assert_eq!(response.headers()["x-route"], "user");
    assert_eq!(
        response.json::<serde_json::Value>().await.unwrap(),
        serde_json::json!({ "id": "123", "name": "Ada" })
    );

    let fallback = reqwest::get(format!("http://127.0.0.1:{port}/users/456"))
        .await
        .unwrap();
    assert_eq!(fallback.status(), 200);
    assert_eq!(fallback.text().await.unwrap(), "fallback text");

    let miss = reqwest::get(format!("http://127.0.0.1:{port}/missing"))
        .await
        .unwrap();
    assert_eq!(miss.status(), 501);
    assert_eq!(miss.headers()["x-mock-miss"], "true");
    assert_eq!(
        miss.json::<serde_json::Value>().await.unwrap(),
        serde_json::json!({ "error": "no active route case matched request" })
    );
}

#[tokio::test]
async fn serve_uses_cli_collection_override_and_accepts_session_header() {
    let fixture = Fixture::new();
    fixture.write_route(
        "users.yml",
        r#"
id: users-by-id
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
        body: ok
      missing:
        status: 404
        body: missing
"#,
    );
    fixture.write_collections(
        r#"
- id: default
  routes:
    - users-by-id:user-123:success

- id: not-found
  from: default
  routes:
    - users-by-id:user-123:missing
"#,
    );

    let port = unused_port();
    let _server = fixture.spawn(port, &["--collection", "not-found"]);
    wait_for_server(port).await;

    let client = reqwest::Client::new();
    let response = client
        .get(format!("http://127.0.0.1:{port}/users/123"))
        .header("x-mock-session", "session-a")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 404);
    assert_eq!(response.text().await.unwrap(), "missing");
}

#[tokio::test]
async fn serve_forwards_selected_passthrough_over_the_cli_request_path() {
    let (upstream_url, captured, upstream) = spawn_upstream();
    let fixture = Fixture::new();
    fixture.write_route(
        "users.yml",
        format!(
            r#"
id: create-user
transport: http
match:
  method: POST
  path: /users
cases:
  any:
    match: {{}}
    behaviors:
      forward:
        kind: passthrough
        target:
          baseUrl: {upstream_url}
"#,
        ),
    );
    fixture.write_collections(
        r#"
- id: default
  routes:
    - create-user:any:forward
"#,
    );

    let port = unused_port();
    let _server = fixture.spawn(port, &[]);
    wait_for_server(port).await;

    let response = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{port}/users?verbose=true"))
        .header("x-decoy-test", "yes")
        .header("connection", "x-strip")
        .header("x-strip", "no")
        .body(r#"{"name":"Ada"}"#)
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), 202);
    assert_eq!(response.headers()["x-upstream"], "yes");
    assert_eq!(response.text().await.unwrap(), "accepted");
    let captured = captured.recv().unwrap();
    assert_eq!(captured.request_line, "POST /users?verbose=true HTTP/1.1");
    assert_eq!(
        captured.headers.get("x-decoy-test"),
        Some(&"yes".to_owned())
    );
    assert!(!captured.headers.contains_key("connection"));
    assert!(!captured.headers.contains_key("x-strip"));
    assert_eq!(captured.body, r#"{"name":"Ada"}"#);
    upstream.join().unwrap();
}

#[tokio::test]
async fn serve_uses_cli_global_passthrough_target_for_selected_passthrough() {
    let (upstream_url, captured, upstream) = spawn_upstream();
    let fixture = Fixture::new();
    fixture.write_route(
        "users.yml",
        r#"
id: users
transport: http
match:
  method: GET
  path: /users/{id}
cases:
  any:
    match:
      pathParams:
        id: "*"
    behaviors:
      forward:
        kind: passthrough
"#,
    );
    fixture.write_collections(
        r#"
- id: default
  routes:
    - users:any:forward
"#,
    );

    let port = unused_port();
    let _server = fixture.spawn(port, &["--passthrough-base-url", &upstream_url]);
    wait_for_server(port).await;

    let response = reqwest::get(format!("http://127.0.0.1:{port}/users/456?source=cli"))
        .await
        .unwrap();

    assert_eq!(response.status(), 202);
    assert_eq!(response.text().await.unwrap(), "accepted");
    let captured = captured.recv().unwrap();
    assert_eq!(captured.request_line, "GET /users/456?source=cli HTTP/1.1");
    upstream.join().unwrap();
}

#[tokio::test]
async fn serve_reads_native_config_file_and_uses_first_collection_by_default() {
    let fixture = Fixture::new();
    fixture.write_route("users.yaml", route_with_id("users"));
    fixture.write_collections(
        r#"
- id: local
  routes:
    - users:any:ok

- id: default
  routes:
    - users:any:ok
"#,
    );
    let port = unused_port();
    fixture.write_config(format!(
        r#"
routes: routes
collections: collections.yaml
port: {port}
"#
    ));

    let _server = fixture.spawn_raw(&["serve", "--config", "decoy.yaml"]);
    wait_for_server(port).await;

    let response = reqwest::get(format!("http://127.0.0.1:{port}/users/123"))
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
}

#[tokio::test]
async fn serve_cli_flags_override_native_config_file_values_during_startup() {
    let fixture = Fixture::new();
    fs::create_dir_all(fixture.temp.path().join("config/routes")).unwrap();
    fs::create_dir_all(fixture.temp.path().join("flag/routes")).unwrap();
    fs::write(
        fixture.temp.path().join("config/routes/who.yaml"),
        route_response("who", "CONFIG"),
    )
    .unwrap();
    fs::write(
        fixture.temp.path().join("flag/routes/who.yaml"),
        route_response("who", "FLAG"),
    )
    .unwrap();
    fs::write(
        fixture.temp.path().join("config/collections.yaml"),
        "- id: config
  routes:
    - who:any:ok
",
    )
    .unwrap();
    fs::write(
        fixture.temp.path().join("flag/collections.yaml"),
        "- id: flag
  routes:
    - who:any:ok
",
    )
    .unwrap();
    fixture.write_config(
        r#"
routes: config/routes
collections: config/collections.yaml
collection: config
port: 1
"#,
    );

    let port = unused_port();
    let _server = fixture.spawn_raw(&[
        "serve",
        "--config",
        "decoy.yaml",
        "--routes",
        "flag/routes",
        "--collections",
        "flag/collections.yaml",
        "--collection",
        "flag",
        "--port",
        &port.to_string(),
    ]);
    wait_for_server(port).await;

    let response = reqwest::get(format!("http://127.0.0.1:{port}/who"))
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.text().await.unwrap(), "FLAG");
}

#[test]
fn duplicate_route_ids_fail_startup_with_diagnostic() {
    let fixture = Fixture::new();
    fixture.write_route("a.yml", route_with_id("dupe"));
    fixture.write_route("nested/b.yaml", route_with_id("dupe"));
    fixture.write_collections("- id: default\n  routes: []\n");

    let output = fixture.output(&[]);

    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("duplicate route id `dupe`"), "{stderr}");
    assert!(stderr.contains("a.yml"), "{stderr}");
    assert!(stderr.contains("nested/b.yaml"), "{stderr}");
}

#[test]
fn missing_startup_collection_fails_startup() {
    let fixture = Fixture::new();
    fixture.write_route("users.yaml", route_with_id("users"));
    fixture.write_collections("- id: default\n  routes: []\n");

    let output = fixture.output(&["--collection", "missing"]);

    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("unknown startup collection `missing`"),
        "{stderr}"
    );
}

#[derive(Debug)]
struct CapturedRequest {
    request_line: String,
    headers: BTreeMap<String, String>,
    body: String,
}

fn spawn_upstream() -> (
    String,
    mpsc::Receiver<CapturedRequest>,
    thread::JoinHandle<()>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let (tx, rx) = mpsc::channel();

    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buffer = Vec::new();
        let mut chunk = [0; 1024];
        loop {
            let read = stream.read(&mut chunk).unwrap();
            if read == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..read]);
            if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
                let text = String::from_utf8_lossy(&buffer);
                let headers_end = text.find("\r\n\r\n").unwrap();
                let head = &text[..headers_end];
                let content_length = head
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                let body_start = headers_end + 4;
                if buffer.len() >= body_start + content_length {
                    break;
                }
            }
        }

        let header_end = buffer
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .unwrap();
        let head = String::from_utf8_lossy(&buffer[..header_end]);
        let mut lines = head.lines();
        let request_line = lines.next().unwrap().to_owned();
        let headers = lines
            .filter_map(|line| {
                let (name, value) = line.split_once(':')?;
                Some((name.to_ascii_lowercase(), value.trim().to_owned()))
            })
            .collect();
        let body = String::from_utf8_lossy(&buffer[header_end + 4..]).to_string();
        tx.send(CapturedRequest {
            request_line,
            headers,
            body,
        })
        .unwrap();

        stream
            .write_all(
                b"HTTP/1.1 202 Accepted\r\ncontent-type: text/plain\r\nx-upstream: yes\r\ncontent-length: 8\r\n\r\naccepted",
            )
            .unwrap();
    });

    (format!("http://{addr}"), rx, handle)
}

struct Server(Child);

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

struct Fixture {
    temp: TempDir,
}

impl Fixture {
    fn new() -> Self {
        let temp = TempDir::new().unwrap();
        fs::create_dir_all(temp.path().join("routes")).unwrap();
        Self { temp }
    }

    fn write_route(&self, relative: impl AsRef<Path>, contents: impl AsRef<str>) {
        let path = self.temp.path().join("routes").join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents.as_ref()).unwrap();
    }

    fn write_collections(&self, contents: impl AsRef<str>) {
        fs::write(self.temp.path().join("collections.yaml"), contents.as_ref()).unwrap();
    }

    fn write_config(&self, contents: impl AsRef<str>) {
        fs::write(self.temp.path().join("decoy.yaml"), contents.as_ref()).unwrap();
    }

    fn spawn(&self, port: u16, extra: &[&str]) -> Server {
        let mut command = Command::new(env!("CARGO_BIN_EXE_decoy"));
        command.args(self.args(port, extra));
        Server(
            command
                .current_dir(self.temp.path())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        )
    }

    fn spawn_raw(&self, args: &[&str]) -> Server {
        Server(
            Command::new(env!("CARGO_BIN_EXE_decoy"))
                .args(args)
                .current_dir(self.temp.path())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        )
    }

    fn output(&self, extra: &[&str]) -> std::process::Output {
        Command::new(env!("CARGO_BIN_EXE_decoy"))
            .args(self.args(unused_port(), extra))
            .current_dir(self.temp.path())
            .output()
            .unwrap()
    }

    fn args(&self, port: u16, extra: &[&str]) -> Vec<String> {
        let mut args = vec![
            "serve".to_owned(),
            "--routes".to_owned(),
            self.temp.path().join("routes").display().to_string(),
            "--collections".to_owned(),
            self.temp
                .path()
                .join("collections.yaml")
                .display()
                .to_string(),
            "--port".to_owned(),
            port.to_string(),
        ];
        args.extend(extra.iter().map(|arg| (*arg).to_owned()));
        args
    }
}

fn route_response(id: &str, body: &str) -> String {
    format!(
        r#"
id: {id}
transport: http
match:
  method: GET
  path: /{id}
cases:
  any:
    behaviors:
      ok:
        status: 200
        body: {body}
"#
    )
}

fn route_with_id(id: &str) -> String {
    format!(
        r#"
id: {id}
transport: http
match:
  method: GET
  path: /users/{{id}}
cases:
  any:
    behaviors:
      ok:
        status: 200
"#
    )
}

fn unused_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

async fn wait_for_server(port: u16) {
    let client = reqwest::Client::new();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if client
            .get(format!("http://127.0.0.1:{port}/__decoy_wait"))
            .send()
            .await
            .is_ok()
        {
            return;
        }
        assert!(Instant::now() < deadline, "server did not start");
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}
