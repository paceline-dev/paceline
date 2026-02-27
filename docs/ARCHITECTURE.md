# Architecture

This document describes how lush works under the hood. It covers the
spec format, build system, runtime, tool system, scheduling, multi-agent
composition, authorization, and observability.

## Overview

Lush is a compiler and runtime for AI agents. The developer interface
is a set of YAML spec files in a git repository. The lush CLI
validates these specs, resolves dependencies, and either runs agents
locally or produces a build manifest for production deployment.

```
                         ┌───────────────┐
                         │  Agent Specs  │
                         │    (YAML)     │
                         └───────┬───────┘
                                 │
                        ┌────────▼────────┐
                        │  lushctl build  │
                        │  (validate,     │
                        │   resolve,      │
                        │   bundle)       │
                        └────────┬────────┘
                                 │
                       ┌─────────▼─────────┐
                       │  Build Manifest   │
                       │  (content-        │
                       │   addressed)      │
                       └─────────┬─────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
     ┌────────▼────────┐ ┌──────▼───────┐ ┌────────▼────────┐
     │  lushctl chat   │ │  lushctl run │ │  lushctl serve  │
     │  (single agent) │ │  (dev stack) │ │  (production    │
     │                 │ │              │ │   server)       │
     └─────────────────┘ └──────────────┘ └─────────────────┘
```

## Spec Format

### Agent Spec

Each agent is defined in `agents/<name>/spec.yaml`. The spec is the
complete, declarative definition of an agent's behavior, capabilities,
and access controls.

```yaml
name: my-agent
model: gemini-2.5-flash

description: |
  You are a helpful assistant that answers questions about our codebase.
  Be concise and cite file paths when referencing code.

skills:
  - skills.sh/namespace/skill-name@1.0

tools:
  # MCP server (remote or local)
  - server: mcp://npx/@anthropic-ai/mcp-filesystem
    access: read

  # Another agent (via MCP)
  - server: lush://other-agent
    access: read

  # Custom TypeScript function
  - name: tools/my-custom-tool
    access: write

acl:
  - principal: group:engineering
    role: execute
  - principal: serviceaccount:orchestrator
    role: execute
```

**Fields:**

| Field         | Required | Description                                  |
|---------------|----------|----------------------------------------------|
| `name`        | yes      | Unique agent identifier                      |
| `model`       | yes      | LLM model to use                             |
| `description` | yes      | System prompt / behavioral instructions      |
| `tools`       | no       | Exhaustive allowlist of available tools       |
| `skills`      | no       | Versioned skill references                   |
| `acl`         | no       | Who can invoke this agent                    |

The `tools` allowlist is **exhaustive** — anything not listed is
inaccessible to the agent, regardless of what skills or MCP servers
might offer.

### Loop Spec

Loops are scheduled agent invocations, defined in `loops/<name>.yaml`.

```yaml
name: daily-digest
schedule: "0 9 * * *"
agent: helper
run_as: serviceaccount:digest-bot
instruction: |
  Summarize the top 3 Hacker News stories from today.
  Be concise — one sentence per story.
acl:
  - principal: group:ops-team
    role: execute
  - principal: group:everyone
    role: read
```

**Fields:**

| Field         | Required | Description                                  |
|---------------|----------|----------------------------------------------|
| `name`        | yes      | Unique loop identifier                       |
| `schedule`    | yes      | Cron expression                              |
| `agent`       | yes      | Agent to invoke (must exist in project)      |
| `run_as`      | yes      | Service account identity for the invocation  |
| `instruction` | yes      | Message sent to the agent on each invocation |
| `acl`         | no       | Who can trigger/view this loop               |

A loop is a scheduled `/chat` invocation. The `instruction` field is the
message content. The loop does not modify the agent — one agent can serve
many loops with different instructions.

### Project Configuration

`lush.yaml` is the project-level configuration file.

```yaml
project: my-project

service_accounts:
  - name: digest-bot
  - name: orchestrator

tool_grants:
  - tool: mcp://integrations.example.com/slack
    grants:
      - principal: serviceaccount:digest-bot
        access: write
      - principal: group:viewers
        access: read

mcp_credentials:
  mcp://integrations.example.com/slack:
    serviceaccount:digest-bot:
      type: oauth
```

**Sections:**

| Section            | Purpose                                           |
|--------------------|---------------------------------------------------|
| `service_accounts` | Declare non-human identities used by loops        |
| `tool_grants`      | Per-principal read/write access to specific tools  |
| `mcp_credentials`  | Credential type declarations for MCP connections   |

Tool grants are separate from agent specs for a reason: the agent spec
defines what an agent **can** do (capability), while tool grants define
who **may** exercise each capability (privilege). Both checks must pass
at runtime.

## Build System

`lushctl build` is the primary error surface. It validates the entire
project and produces a content-addressed build manifest.

### Validation Pipeline

1. **Spec parsing** — YAML syntax, schema validation via zod
2. **Model validation** — reject unknown models, suggest alternatives
3. **Tool resolution** — MCP server reachability (with timeout), local
   tool file existence and export validation
4. **Skill resolution** — fetch from registry, verify `skills.lock`
   integrity, extract tools and prompt fragments
5. **Reference validation** — loop→agent refs exist, `lush://`
   agent refs exist
6. **ACL consistency** — all principals are valid format, all service
   accounts in `run_as` and grants are declared, all tools in grants
   appear in at least one agent's allowlist
7. **Bundle** — compile local TypeScript tools, compose skill fragments

### Build Manifest

The output is a content-addressed JSON manifest at
`.lush/build/<hash>.json`. Same inputs always produce the same hash.
The manifest contains:

- All resolved agent specs (with skill injections applied)
- All resolved loop specs
- Bundled local tool code
- Resolved skill metadata
- Input hash for deduplication

`lushctl serve` reads from this manifest. This is the artifact that any
deployment system — self-hosted or managed — consumes.

### Error Reporting

Every build error includes:

- Source file and line number
- What's wrong
- Suggestion to fix (when possible)

```
agents/helper/spec.yaml:3
  ✗ Unknown model "gpt-5". Supported: gemini-2.5-flash, gemini-2.5-pro
```

Non-fatal issues (unused grants, unreferenced skills) are reported as
warnings.

## Runtime

### ADK Bridge

Lush uses [Google ADK](https://github.com/google/adk-js) as the
agent runtime. The bridge layer (`packages/runtime`) translates parsed
specs into ADK `LlmAgent` instances:

- `spec.name` → agent name
- `spec.description` (+ composed skill fragments) → system instruction
- `spec.model` → model selection
- `spec.tools` → ADK tool array (McpToolset for MCP, custom functions
  for local tools)

The bridge is intentionally thin. ADK handles the tool execution loop,
model interaction, and response streaming. Lush adds spec-driven
configuration, validation, and the surrounding infrastructure.

### Execution Modes

**`lushctl chat <agent>`** — instantiates a single agent, runs an
interactive session or reads stdin. No server, no overhead.

**`lushctl run`** — starts all agents and loops, launches a dev server with
web UI, API endpoints, and trace viewer. Uses Bun's native `--hot` for
automatic reload on file changes.

**`lushctl serve`** — production mode. Reads from a build manifest, serves
API endpoints, runs loops on cron. No dev UI, no file watcher. Designed
for containerized deployment.

## Tool System

Tools come in three forms, all declared in the agent spec's `tools`
allowlist.

### MCP Servers

External tool servers connected via the
[Model Context Protocol](https://modelcontextprotocol.io). Declared
by URL:

```yaml
tools:
  - server: mcp://npx/@anthropic-ai/mcp-filesystem
    access: read
```

Lush uses ADK's `McpToolset` to establish and manage MCP
connections. Supports both stdio (local processes) and SSE (remote
servers) transports.

### Custom TypeScript Tools

Local functions defined using `defineTool()`:

```typescript
import { defineTool } from '@lush-agents/runtime';

export default defineTool({
  name: 'lookup_weather',
  description: 'Get current weather for a city',
  parameters: { city: { type: 'string', description: 'City name' } },
  execute: async ({ city }) => {
    const res = await fetch(`https://wttr.in/${city}?format=j1`);
    return res.json();
  },
});
```

Referenced by path in the spec. Bun executes TypeScript natively — no
compile step needed during development.

### Agent-as-Tool

Agents expose an MCP interface, making them callable as tools by other
agents via the `lush://` URL scheme:

```yaml
tools:
  - server: lush://researcher
    access: read
```

At runtime, `lush://researcher` resolves to the agent's MCP
endpoint (local or network address). The calling principal is propagated,
and the target agent's ACL is enforced.

### Read/Write Classification

Every tool is classified as `read` or `write`:

- **Read tools** execute normally in all environments
- **Write tools** are stubbed by default — they log the intended call
  and return a mock success response
- The `--live-writes` flag (or per-tool `--live-writes=mcp://...`)
  enables real write execution
- Classification is enforced at the tool dispatch layer and recorded
  in traces

This is the foundation for safe agent testing: observe what an agent
**would** do before enabling real side effects.

### Credential Injection

MCP servers that require authentication receive credentials at
invocation time, injected by the runtime:

1. **Service accounts** — credentials looked up from `mcp_credentials`
   in `lush.yaml`
2. **Users** — credentials looked up from `.lush/credentials.local`
   (populated via `lushctl auth add`)
3. **Missing credentials** — clear error identifying the tool, the
   principal, and how to configure the credential

Agent code never sees credentials directly.

## Scheduling

Loops are scheduled agent invocations with cron expressions.

In `lushctl run`, loops are managed by an in-process cron scheduler. In
`lushctl serve`, loops run with production guarantees:

- **At-least-once delivery** — if the server restarts, missed firings
  are detected and replayed
- **Deduplication** — each firing carries a deduplication key
  (loop name + scheduled time) to prevent double execution
- **Concurrency limits** — configurable max concurrent invocations
  per loop
- **Wall-clock timeouts** — invocations are killed after a configurable
  timeout

`lushctl loop trigger <name>` fires a loop manually, with an optional
`--instruction` override for testing variants.

## Multi-Agent Composition

Agents compose via MCP. An agent lists another agent's endpoint as a
tool:

```yaml
# agents/orchestrator/spec.yaml
tools:
  - server: lush://researcher
    access: read
```

When the orchestrator calls this tool, the runtime:

1. Resolves `lush://researcher` to the researcher agent's MCP
   endpoint
2. Propagates the calling principal
3. Checks the researcher's ACL (calling principal must have `execute`)
4. Dispatches the call and returns the result
5. Links the invocations as parent/child spans in OTel traces

This model scales from two agents in a single project to distributed
agent networks across multiple services, all using the same MCP protocol
and ACL model.

## Authorization

### Principals

Three principal types:

| Type                       | Description                               |
|----------------------------|-------------------------------------------|
| `user:{id}`                | Authenticated human                       |
| `group:{name}`             | Named set of users                        |
| `serviceaccount:{name}`    | Non-human identity (declared in lush.yaml) |

Principal resolution is pluggable: from a bearer token, a request
header, or local config. This allows lush to integrate with any
identity provider.

### Two-Step Authorization

Every tool dispatch goes through two checks:

1. **Capability check** — is this tool in the agent's `tools` allowlist?
2. **Privilege check** — does the calling principal have a `tool_grant`
   for this tool with the required access level (read or write)?

Both must pass. This separation means agent specs define **what's
possible** while `lush.yaml` controls **who's allowed**.

### ACL Scopes

| Resource | Roles              | Meaning                        |
|----------|--------------------|--------------------------------|
| Agent    | `execute`          | Can invoke the agent           |
| Loop     | `execute`, `read`  | Can trigger / can view history |
| Tool     | `read`, `write`    | Can use the tool at this level |

### Build-Time Validation

`lushctl build` validates the entire ACL graph:

- Every `run_as` service account is declared
- Every principal in grants uses valid format
- Every tool in grants appears in at least one agent's allowlist
- Orphaned grants (tool no agent uses) produce warnings

## Observability

Lush uses [OpenTelemetry](https://opentelemetry.io) for all
instrumentation. Every agent invocation produces a structured trace.

### Trace Structure

```
Root Span: agent invocation
├── agent: helper
├── principal: user:connor
├── model: gemini-2.5-flash
├── tokens.input: 85
├── tokens.output: 57
├── status: success
│
├── Child Span: tool call
│   ├── tool: mcp://npx/@anthropic-ai/mcp-filesystem
│   ├── access: read
│   ├── latency: 45ms
│   └── status: success
│
└── Child Span: tool call
    ├── tool: tools/lookup-weather
    ├── access: read
    ├── latency: 320ms
    └── status: success
```

Multi-agent invocations link parent and child spans across agents.

### Storage and Export

| Mode           | Backend                                     |
|----------------|---------------------------------------------|
| `lushctl run`     | In-memory (dev), SQLite (persistent)        |
| `lushctl serve`   | Configurable: SQLite, OTLP export, or both  |

OTel-native export means traces flow directly into Jaeger, Grafana
Tempo, Datadog, or any OTLP-compatible backend with zero custom
integration.

### Write Audit Trail

Write tool invocations are tagged as distinct audit events in traces.
Every write records: timestamp, agent, principal, tool, arguments,
response, and environment. Write audits are queryable separately from
general traces for compliance purposes.

### Metrics

Aggregated from trace data:

- **Per-tool**: call count, success/error rate, p50/p95 latency,
  read/write breakdown
- **Per-agent**: invocation count, token consumption, tool usage
  histogram
- **Tool usage patterns**: identify under-used tools (declared but
  rarely called) and over-used tools (disproportionate call volume)
- **Token trends**: consumption per agent, per model, over time
- **ACL signals**: grant usage frequency, denied attempts

## Production Deployment

### `lushctl serve`

The production server is a single Bun process that reads from a build
manifest:

```
lushctl build → .lush/build/<hash>.json → lushctl serve
```

Configuration is entirely via environment variables:

| Variable                       | Default   | Description               |
|--------------------------------|-----------|---------------------------|
| `PORT`                         | `8080`    | Listen port               |
| `LOG_LEVEL`                    | `info`    | Log verbosity             |
| `GOOGLE_API_KEY`               | —         | Gemini API key            |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | —         | OTel collector URL        |
| `TRACE_BACKEND`                | `sqlite`  | `sqlite`, `otlp`, `none` |

### API Endpoints

| Endpoint                         | Method | Description              |
|----------------------------------|--------|--------------------------|
| `/agents/:name/chat`             | POST   | JSON request/response    |
| `/agents/:name/chat/stream`      | POST   | Streaming (SSE)          |
| `/agents/:name/mcp`              | —      | MCP server interface     |
| `/agents/:name/status`           | GET    | Agent info               |
| `/agents`                        | GET    | List all agents          |
| `/health`                        | GET    | Health check             |

### Containerization

`lushctl serve` is designed for containerized deployment. The recommended
Dockerfile uses a multi-stage build with a Bun base image, runs as a
non-root user with a read-only filesystem, and wires `/health` to a
Docker `HEALTHCHECK`.

Deploy the container to Kubernetes (Helm chart provided), ECS, Cloud
Run, Fly.io, or any platform that runs OCI containers.

### Content-Addressed Rollouts

Build manifests are content-addressed: same inputs produce the same
hash. This enables:

- **Deduplication** — skip deploy if the manifest hash hasn't changed
- **Rollback** — redeploy a previous manifest by hash
- **Audit** — every deployment is traceable to a specific manifest

## Technology

| Layer          | Choice                                                |
|----------------|-------------------------------------------------------|
| Agent runtime  | [Google ADK](https://github.com/google/adk-js)        |
| Models         | Gemini (via ADK, extensible)                           |
| Tool protocol  | [MCP](https://modelcontextprotocol.io)                 |
| Skills         | [Anthropic skill format](https://skills.sh)            |
| Spec parsing   | [zod](https://zod.dev) + [yaml](https://eemeli.org/yaml/) |
| Runtime        | [Bun](https://bun.sh)                                 |
| Traces         | [OpenTelemetry](https://opentelemetry.io)              |
