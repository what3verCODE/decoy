# Codec plugin external command hosting research

Status: research note for [#163](https://github.com/what3verCODE/decoy/issues/163). This is design evidence, not an implementation decision.

## Context

Decoy's glossary defines a **Plugin** as an advanced extension package and a **Codec plugin** as the first likely seam: convert wire bytes to logical messages and logical messages back to wire bytes. ADR 0001 chooses a future Rust/native runtime and keeps plugins out of the first HTTP milestone. The current design note says Herdr-style external command plugins are attractive because they use a manifest, an executable command, and host-provided context/API while avoiding broad lifecycle hooks.

## Plausible hosting patterns

### Pattern A: manifest-declared one-shot command

A plugin is a directory containing a manifest plus one or more commands. The host discovers and validates the manifest, chooses a command, invokes it as an argv array, passes one request on stdin or an environment variable/file, reads one response from stdout, treats stderr as diagnostics, and enforces exit status, timeout, and output-size rules.

Evidence:

- Herdr v1 plugins are directories with `herdr-plugin.toml`; the manifest declares required metadata, supported platforms, build commands, and entrypoints. Herdr validates the manifest, injects runtime context, starts declared commands, records logs, and exposes host access through the CLI/socket API rather than a separate SDK.
- Herdr command values are argv arrays, not shell strings, so shell expansion only happens if the plugin explicitly launches a shell.
- Protobuf `protoc` plugins are a very small one-shot model: a plugin reads `CodeGeneratorRequest` from stdin and writes `CodeGeneratorResponse` to stdout; the executable is discovered by name (`protoc-gen-$NAME`) on `PATH` when `--${NAME}_out` is used.
- Kubernetes client-go exec credential plugins are configured with `command`, `args`, `env`, `apiVersion`, `installHint`, `provideClusterInfo`, and `interactiveMode`; the command outputs structured credentials and client-go has policy hooks such as allow-all, deny-all, or allowlist.

Decoy fit:

- Manifest discovery could search explicit config paths first, then user/global plugin dirs, then possibly project-local plugin dirs. A minimal `decoy-codec-plugin.toml` could require `id`, `name`, `version`, `min_decoy_version`, `codec_api_version`, `platforms`, and one or more codec entrypoints such as `decode` and `encode` argv arrays.
- Executable invocation could pass a stable JSON request on stdin: `{apiVersion, pluginId, codecId, operation, routeId, mediaType, bytesBase64, config}` and require JSON on stdout: `{ok, message}` or `{ok:false, diagnostic}`. Stderr should be logs only; non-zero exit means host-level failure.
- Plugin identity should be manifest-owned, stable, and globally qualified. Route YAML should reference something like `codec: vendor.plugin/codec-id` or `{plugin: vendor.plugin, codec: msgpack-protobuf}` rather than an executable path, so routes remain portable and plugin installation stays separate.
- Native runtime implication: Rust only needs process spawning, JSON/schema validation, timeout handling, and base64/byte limits. It does not need to load foreign code or embed Node, Python, or Go.

Strengths:

- Smallest host surface and easiest to prototype.
- Good failure isolation; plugin crashes do not crash Decoy.
- Language-agnostic and compatible with Decoy's native-runtime direction.
- Manifest metadata can drive install errors, platform gating, and route-reference validation.

Costs:

- Starting a process per frame/message can be too slow for WebSocket streams or chatty protocols.
- Large binary payloads become awkward through JSON/base64 on stdin/stdout.
- Per-invocation state is difficult unless the plugin manages files or external processes.

### Pattern B: manifest-declared long-running sidecar command

A plugin is still discovered through a manifest, but the manifest declares a server command. Decoy launches or connects to a long-lived subprocess, performs a handshake, then sends many encode/decode requests over a local protocol such as JSON-RPC over stdio, length-delimited JSON, or local gRPC.

Evidence:

- HashiCorp `go-plugin` launches plugins as subprocesses and communicates over RPC/gRPC on a local reliable connection. The README calls out process isolation, cross-language gRPC support, bidirectional communication, protocol versioning, stdout/stderr syncing, checksums, TLS, and reattach support.
- HashiCorp's non-Go plugin guide says a gRPC plugin serves the application service, registers gRPC health checking, then writes one stdout handshake line containing core protocol version, app protocol version, network type/address, and protocol so the host can connect.
- Terraform provider plugins are long-lived provider servers. `terraform-plugin-go` exposes provider server interfaces and serve functions, and debug mode can keep a provider server running while Terraform connects via a reattach configuration.

Decoy fit:

- Manifest discovery and identity stay the same as Pattern A, but entrypoints would be `server` plus declared protocol support (`jsonrpc-stdio-v1`, `grpc-local-v1`).
- Invocation begins with Decoy launching the server command using argv, a limited environment, plugin config/state dirs, and an optional host-supplied socket/API location. The plugin responds with a versioned handshake and advertised codec capabilities.
- Decoy can reuse the sidecar across sessions/routes and route every encode/decode request by `(pluginId, codecId, apiVersion)`. Plugin identity must survive process restarts and should be pinned to manifest ID plus install source/revision in diagnostics.
- Native runtime implication: Rust must own sidecar lifecycle, readiness/health checks, backpressure, cancellation, restart policy, log capture, and protocol compatibility. This is more like hosting a local service than running a converter command.

Strengths:

- Better latency and amortized startup cost for streams.
- Can cache schemas, compiled descriptors, dictionaries, or compression state.
- Supports richer diagnostics and capability negotiation.

Costs:

- Much larger host lifecycle surface: process supervision, handshake, health, shutdown, concurrency, and stale sidecar recovery.
- More ways for plugins to hang or leak resources.
- Harder to keep developer UX simple without an SDK or generated protocol bindings.

### Pattern C: PATH convention without Decoy-managed install

The host maps a codec reference directly to an executable naming convention, similar to `protoc-gen-$NAME`, and executes the binary from `PATH` or an explicit path in config. There may be no manifest beyond a `--version`/`--capabilities` command.

This is plausible for expert/local use, but it is a weak default for Decoy because route YAML would either encode machine-local paths or rely on hidden `PATH` state. It also lacks platform metadata, install hints, minimum Decoy version, and stable plugin identity unless Decoy invents a separate registry file.

## Discovery, invocation, and identity recommendation

Use manifest-first discovery even if the first prototype only supports one-shot commands.

- **Discovery:** scan explicit project config, then user plugin directories. Validate manifests before routes are loaded far enough to accept codec references. Do not auto-discover arbitrary `PATH` executables as plugins by default.
- **Invocation:** use argv arrays, never shell strings. Start with a one-shot JSON-over-stdio protocol for prototypes; reserve a manifest field for future sidecar protocols so the manifest shape does not preclude Pattern B.
- **Identity:** require manifest `id` and local `codec` ids. Route YAML references `plugin-id/codec-id`; Decoy diagnostics include plugin id, codec id, manifest version, source path or install source, and protocol version. Executable paths are implementation details, not route semantics.

## Risks

- **Portability:** manifest commands may depend on Node/Python/Go tools that are absent on another machine. Require `platforms` and add install hints; prefer compiled single binaries for commonly shared codecs.
- **Installation:** GitHub or package-manager installs raise trust and repeatability questions. Pinning source revisions/checksums may be needed before a marketplace or team-shared workflow.
- **Security:** plugins run as the user and can access files/env/network unless Decoy adds sandboxing. Default posture should be explicit install/link, visible manifest preview, argv-only execution, limited host-provided secrets, timeout/output limits, and optional allowlists for CI.
- **Developer UX:** one-shot commands are easy but may be slow; sidecars are fast but need protocol tooling. Error messages must separate route codec-reference errors, install/discovery errors, plugin diagnostics, protocol violations, and codec failures.
- **Native runtime complexity:** every extra lifecycle hook competes with the Rust HTTP milestone. Avoid arbitrary lifecycle hooks, UI plugins, and custom matchers until codec semantics are stable.

## Questions to grill next

- Should Decoy route YAML reference codecs by `plugin-id/codec-id`, by a manifest-declared alias, or by a project-local logical name resolved in config?
- What is the minimal codec API: only `decode(bytes)->message` and `encode(message)->bytes`, or does matching need metadata such as content type, frame direction, schema id, or route bindings?
- What is Decoy's trust model for CI: deny all external plugins unless allowlisted, allow project-local plugins, or allow user-installed plugins?
- Are plugin installs global to the user, project-local, or both? Which one is portable enough for teams?

## Prototype candidates

1. Prototype Pattern A with a fixture plugin that decodes base64 JSON or MessagePack through a manifest-declared argv command. Measure startup overhead and specify timeout/error/log behavior.
2. Prototype route/config identity resolution without executing plugins: validate `plugin-id/codec-id`, missing plugin diagnostics, duplicate ID errors, and platform mismatch messages.
3. If Pattern A is too slow for WebSocket frames, prototype Pattern B as JSON-RPC over stdio before committing to gRPC; this keeps native dependencies lower while testing lifecycle complexity.

## Sources and local evidence

- Decoy glossary: `CONTEXT.md` defines Plugin and Codec plugin.
- Decoy native runtime direction: `docs/adr/0001-rust-runtime-and-semantic-model.md`.
- Decoy plugin posture: `docs/design/next-direction.md` and `docs/design/github-reset-plan.md`.
- Herdr plugin docs: <https://github.com/herdrdev/herdr/blob/master/docs/next/website/src/content/docs/plugins.mdx>.
- Herdr marketplace docs: <https://github.com/herdrdev/herdr/blob/master/docs/next/website/src/content/docs/marketplace.mdx>.
- Herdr socket/API docs: <https://github.com/herdrdev/herdr/blob/master/docs/next/website/src/content/docs/socket-api.mdx>.
- Protobuf compiler plugin protocol: <https://github.com/protocolbuffers/protobuf/blob/main/src/google/protobuf/compiler/plugin.proto>.
- HashiCorp go-plugin README: <https://github.com/hashicorp/go-plugin/blob/main/README.md>.
- HashiCorp non-Go plugin guide: <https://github.com/hashicorp/go-plugin/blob/main/docs/guide-plugin-write-non-go.md>.
- Terraform plugin-go README: <https://github.com/hashicorp/terraform-plugin-go/blob/main/README.md>.
- Kubernetes client-go exec plugin config type: <https://github.com/kubernetes/client-go/blob/master/tools/clientcmd/api/types.go>.
