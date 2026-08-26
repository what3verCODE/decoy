# Codec plugin JSON-over-stdio protocol research

Status: research note for #164; feeds #138 and #155. This is not an implementation design or ADR.

## Question

Decoy may eventually host codec plugins as external commands. A codec plugin converts wire bytes to
logical messages and logical messages back to wire bytes, especially for future WebSocket/gRPC/custom
protocol envelopes. This note records constraints for a JSON-over-stdio host/plugin protocol before
implementation tickets are safe.

Local constraints from the Decoy design reset:

- Plugins are roadmap, not part of the first native HTTP runtime milestone.
- Decoy is a mock tool with plugins for advanced cases, not a plugin framework first.
- The first likely plugin seam is `bytes <-> logical message`; plugin design must preserve
  Route/Case/Behavior matching semantics and keep protocol plumbing out of route YAML.

## Viable framing choices

### 1. Newline-delimited JSON messages

Shape: each stdin/stdout record is exactly one compact JSON object followed by `\n`.

Example:

```json
{"id":"1","op":"decode","payload":{"encoding":"base64","bytes":"kgKi..."}}
```

This is the simplest fit when every protocol message is a single JSON object and all binary payloads
are encoded inside JSON strings, usually as base64. MCP's stdio transport uses this model for
JSON-RPC messages: messages are newline-delimited, must not contain embedded newlines, logs go to
`stderr`, and neither side may write non-protocol data to the protocol stream.

Pros:

- Easy to inspect with line-oriented logs, fixtures, and golden tests.
- Easy to implement with buffered line readers in Rust, Node, Python, Go, etc.
- No header parser and no length accounting bugs.

Cons:

- The host must require compact JSON records or otherwise reject embedded newlines.
- Large base64 payloads create long lines and add size overhead.
- Resynchronization after a truncated or partial line is poor; the safest recovery is usually to
  terminate the plugin process.

Use this when simplicity and debuggability are more important than preserving pretty-printed JSON on
the wire.

### 2. `Content-Length` framed JSON

Shape: ASCII headers terminated by `\r\n\r\n`, followed by exactly `Content-Length` bytes of UTF-8
JSON.

Example:

```txt
Content-Length: 78\r\n
\r\n
{"id":"1","op":"decode","payload":{"encoding":"base64","bytes":"kgKi..."}}
```

The Language Server Protocol and Debug Adapter Protocol both use `Content-Length` style framing over
streams. LSP requires `Content-Length`, encodes the header part as ASCII, separates headers from
content with `\r\n\r\n`, and treats the content as UTF-8 JSON.

Pros:

- Supports pretty-printed JSON and embedded newlines in the payload.
- Handles large messages without line-length assumptions.
- A declared length allows earlier detection of short reads, oversized frames, and trailing garbage.

Cons:

- More code: parser state, byte counting, header validation, max-frame enforcement.
- Less friendly for humans tailing stdout directly.
- A bad length can desynchronize the stream; termination is still the likely safe recovery.

Use this if codec traffic needs large payloads or if route/debug fixtures benefit from formatted JSON
inside the protocol stream.

### 3. JSON-RPC envelope, independent of framing

JSON-RPC is an envelope choice, not a complete stdio framing choice. It standardizes request ids,
responses, notifications, and an error object with `code`, `message`, and optional `data`. It can ride
on either newline framing or `Content-Length` framing.

Pros:

- Request/response correlation and structured errors are already specified.
- Notifications give a known shape for one-way events if Decoy later needs them.

Cons:

- JSON-RPC's generic error codes do not by themselves express Decoy-specific diagnostics such as
  plugin spawn failure, timeout, invalid frame, decode failure, or encode failure.
- Batching and notifications should probably be disabled initially to keep host/plugin behavior
  deterministic.

Recommendation: if Decoy wants a familiar RPC envelope, use a small JSON-RPC-compatible subset:
single in-flight request per plugin process at first, request ids required, no batches, no stdout log
notifications, and Decoy-specific error `data` fields.

## Log separation

Protocol stdout must be reserved for protocol frames only. Plugin logs should go to `stderr` as UTF-8
text. This mirrors MCP's stdio constraints and avoids corrupting a line-delimited or
`Content-Length` protocol stream.

Practical requirements for later design:

- The host captures plugin `stderr` separately from stdout.
- The host associates stderr chunks/lines with plugin id, process id, request id if known, and time.
- The host truncates or rate-limits captured logs before embedding them in Decoy diagnostics.
- A plugin that writes non-protocol bytes to stdout is a protocol violation; Decoy should fail the
  in-flight operation, include a bounded diagnostic snippet, and usually restart or disable the
  plugin process.
- Do not invent stdout log notifications for the first design. They compete with the protocol stream
  and require decoding to debug decoding failures.

## Bytes and logical-message exchange

JSON has strings, numbers, booleans, arrays, objects, and null; it has no native byte string type.
Therefore wire bytes should not be represented as raw JSON strings unless the protocol explicitly
chooses a reversible encoding. The safest initial shape is explicit base64:

```json
{
  "jsonrpc": "2.0",
  "id": "42",
  "method": "decode",
  "params": {
    "routeId": "orders-ws",
    "codecId": "msgpack-protobuf",
    "direction": "clientToServer",
    "bytes": { "encoding": "base64", "data": "kgKi..." }
  }
}
```

Decode responses should return a logical message object that Decoy matching/templates can evaluate
without learning the wire protocol:

```json
{
  "jsonrpc": "2.0",
  "id": "42",
  "result": {
    "message": {
      "type": "OrderPlaced",
      "headers": { "schema": "v3" },
      "body": { "orderId": "ord_123" }
    }
  }
}
```

Encode requests reverse that shape: Decoy supplies the selected logical message/behavior output and
the plugin returns base64 wire bytes.

## Timeout behavior considerations

Timeouts are host policy, not something stdio or JSON-RPC solves. Decoy should specify at least four
separate budgets before implementation:

1. Spawn/init timeout: how long a plugin may take to start and advertise readiness.
2. Per-request decode timeout.
3. Per-request encode timeout.
4. Shutdown timeout before force-kill.

Recommendations:

- Defaults should be conservative and fail-closed; a stuck codec must not hang the runtime.
- Timeouts should produce Decoy diagnostics that name plugin id, operation, route/message context,
  elapsed time, configured budget, and a bounded stderr tail.
- The first implementation should avoid concurrent requests to one plugin process unless a prototype
  proves request multiplexing is safe and useful.
- After a timeout, treat the plugin process as tainted. Drain/restart it rather than attempting to
  reuse a stream whose next frame may belong to the timed-out request.
- Allow manifest/config overrides later, but keep a hard maximum to prevent accidental infinite waits.

## Error-shape considerations

There are two layers of errors:

1. Transport/protocol errors detected by the host: spawn failed, invalid stdout frame, malformed JSON,
   unknown response id, EOF, stderr flood, timeout, oversized frame.
2. Codec errors returned by the plugin: cannot decode bytes, unsupported schema, cannot encode logical
   message, invalid plugin configuration.

A useful error shape should be stable, small, and diagnostic:

```json
{
  "code": "DECOY_CODEC_DECODE_FAILED",
  "message": "codec `msgpack-protobuf` could not decode client message",
  "retryable": false,
  "plugin": { "id": "msgpack-protobuf", "command": "decoy-codec-msgpack" },
  "operation": "decode",
  "requestId": "42",
  "context": { "routeId": "orders-ws", "direction": "clientToServer" },
  "data": { "cause": "unknown protobuf type id 99" }
}
```

If Decoy uses JSON-RPC, the plugin's response can still use JSON-RPC's `error.code`,
`error.message`, and `error.data`, but Decoy should map it into a Decoy diagnostic code before
presenting it to users. Numeric JSON-RPC codes alone are not expressive enough for user-facing Decoy
failure modes.

## Debuggability requirements

Later implementation tickets should include:

- A trace mode that records host/plugin frames with base64 payloads redacted or size-limited.
- A way to replay captured frames against a plugin executable without running the full Decoy runtime.
- Bounded stderr capture attached to failures.
- Clear distinction between "plugin returned a codec error" and "host/plugin protocol broke".
- Max-frame-size and max-stderr-size diagnostics.
- Tests with deliberately noisy stderr to prove logs do not corrupt stdout parsing.

## What must be prototyped before implementation tickets are safe

1. Newline framing vs `Content-Length` framing under realistic codec payload sizes, including invalid
   stdout bytes, truncated frames, oversized frames, and human-readable traces.
2. Single in-flight request per process vs multiplexed request ids, especially how timeout recovery
   works without stream desynchronization.
3. Base64 byte payload overhead for the target WebSocket msgpack/protobuf use case.
4. Restart/disable policy after timeout, EOF, or invalid stdout.
5. Error mapping from plugin-returned errors and host-detected protocol errors into Decoy's
   fail-closed diagnostics.
6. Stderr capture behavior: multiline logs, high-volume logs, logs emitted during a hung request, and
   redaction/truncation.
7. A tiny throwaway host plus two plugins: one well-behaved and one intentionally corrupt/noisy, so
   tests prove protocol safety before real plugin work begins.

## Recommendation for the next design step

Prefer newline-delimited compact JSON for the first throwaway prototype because it is easiest to
inspect and matches MCP's strict stdio/log separation rules. Keep the envelope JSON-RPC-compatible
for request ids and errors, but explicitly defer batches, notifications, and request multiplexing.

If the prototype shows large-line or formatting pain, switch to LSP/DAP-style `Content-Length`
framing before freezing the plugin protocol.

## Sources and local evidence

- Issue #138, "Design codec plugin seam": codec plugin posture, target use case, and non-goals.
- Issue #155, "Spec: Codec plugin seam wayfinder": decision-map scope, no implementation tickets yet,
  and JSON-over-stdio/error/log/timeout topics.
- Issue #164, "Research JSON-over-stdio protocol constraints": acceptance criteria for this note.
- `CONTEXT.md`: normative definitions for Plugin and Codec plugin.
- `docs/design/next-direction.md`: plugin roadmap posture and Herdr-style external command interest.
- `docs/adr/0001-rust-runtime-and-semantic-model.md`: Rust runtime direction and plugin/WebSocket
  roadmap boundary.
- Model Context Protocol specification, 2025-06-18, Transports / stdio: newline-delimited JSON-RPC,
  no embedded newlines, stdout restricted to protocol messages, stderr for logging.
  <https://modelcontextprotocol.io/specification/2025-06-18/basic/transports>
- Language Server Protocol 3.17 specification, Base Protocol: `Content-Length` header framing,
  ASCII headers, `\r\n\r\n` separator, UTF-8 JSON content.
  <https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/>
- Debug Adapter Protocol overview, Base Protocol: `Content-Length` header framing with ASCII header
  and JSON content.
  <https://microsoft.github.io/debug-adapter-protocol/overview>
- JSON-RPC 2.0 specification: request ids, responses, notifications, and error object with `code`,
  `message`, and optional `data`.
  <https://www.jsonrpc.org/specification>
- RFC 8259, The JavaScript Object Notation (JSON) Data Interchange Format: JSON value types and UTF-8
  interoperability context; no native byte-string type.
  <https://www.rfc-editor.org/rfc/rfc8259>
