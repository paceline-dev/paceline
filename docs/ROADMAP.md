# Paceline OSS Roadmap

Paceline is a spec-driven framework for building, running, and deploying
AI agents. You define agents in YAML, and paceline handles the rest —
validation, tool wiring, scheduling, access control, and observability.

This roadmap covers the open-source project. Each milestone unlocks a
concrete demo and is tracked as a GitHub Project.

---

## CLI Commands

These are the commands paceline will provide, introduced progressively
across milestones:

| Command                  | Milestone | Purpose                                  |
|--------------------------|-----------|------------------------------------------|
| `pace init`              | 1         | Scaffold a new paceline project          |
| `pace chat <agent>`      | 1         | Chat with a single agent (TTY-aware)     |
| `pace build`             | 4         | Validate specs, emit build manifest      |
| `pace run`               | 5         | Start all agents, loops, web UI, API     |
| `pace loop trigger`      | 6         | Manually fire a loop                     |
| `pace serve`             | 8         | Run production server (no dev UI)        |
| `pace auth add <tool>`   | 5         | Store local credentials                  |
| `pace skill add`         | 9         | Add a skill from a registry              |

---

## Milestone 1: Spec to Chat

**Demo:** Write a 5-line YAML file, run `pace chat helper`, have a
conversation in your terminal.

```yaml
# agents/helper/spec.yaml
name: helper
model: gemini-2.5-flash
description: You are a helpful assistant that answers questions concisely.
```

```
$ pace chat helper
🟢 helper (gemini-2.5-flash)

You: What's the capital of France?
helper: Paris.
```

Pipe mode (non-TTY):

```
$ echo "What's the capital of France?" | pace chat helper
Paris.
```

### What we build

- Monorepo scaffolding (pnpm workspaces, TypeScript, esbuild)
- `packages/core`: YAML spec parser with zod schema validation
- `packages/runtime`: Bridge that instantiates a Google ADK `LlmAgent`
  from a parsed spec
- `packages/cli`: `pace init` and `pace chat <agent>` commands
- TTY detection: interactive readline in terminals, stdin/stdout in pipes
- Wire ADK to Gemini (`GOOGLE_API_KEY` env var)
- Starter template: `pace init` scaffolds the canonical project structure

### What this proves

The spec format drives real behavior. A YAML file becomes a running agent.

---

## Milestone 2: MCP Tools

**Demo:** Add MCP server tools to your agent spec with read/write
classification. Agent uses them in conversation.

```yaml
# agents/file-reader/spec.yaml
name: file-reader
model: gemini-2.5-flash
description: You help users understand codebases by reading and analyzing files.
tools:
  - server: mcp://npx/@anthropic-ai/mcp-filesystem
    access: read
```

```
$ pace chat file-reader
🟢 file-reader (gemini-2.5-flash)
   tools: filesystem (read)

You: What's in the README?
file-reader: [reads README.md via MCP] The README contains...
```

### What we build

- Extend spec schema for `tools` section (MCP URLs + access classification)
- ADK `McpToolset` integration — connect to MCP servers declared in spec
- Read/write enforcement: write tools log "would have" by default,
  `--live-writes` flag enables them
- Tool status display on startup (connected, access level)

### What this proves

Declarative tool binding works. The spec is the single source of truth
for what an agent can do.

---

## Milestone 3: Custom TypeScript Tools

**Demo:** Write a function in `tools/`, reference it in your spec, agent
calls it.

```typescript
// tools/lookup-weather.ts
import { defineTool } from '@paceline/runtime';

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

```yaml
# agents/weather/spec.yaml
name: weather-bot
model: gemini-2.5-flash
description: You help users check the weather.
tools:
  - name: tools/lookup-weather
    access: read
```

```
$ pace chat weather-bot
🟢 weather-bot (gemini-2.5-flash)
   tools: lookup_weather (read, local)

You: What's the weather in Portland?
weather-bot: Currently 52°F and cloudy in Portland.
```

### What we build

- `defineTool()` helper that produces ADK-compatible tool definitions
- Build step: esbuild bundles local TypeScript tools
- Tool resolution: local path refs resolved relative to project root
- Type-safe tool parameters via zod inference

### What this proves

Extending agents with custom logic is trivial — just write a function.

---

## Milestone 4: Build System

**Demo:** Run `pace build` with intentional misconfigurations, get clear
errors before anything runs.

```
$ pace build

✗ Build failed (4 errors)

  agents/helper/spec.yaml:3
    ✗ Unknown model "gpt-5". Supported: gemini-2.5-flash, gemini-2.5-pro

  agents/file-reader/spec.yaml:6
    ✗ MCP server unreachable: mcp://localhost:9999/tools
      Did you mean: mcp://npx/@anthropic-ai/mcp-filesystem?

  loops/daily-summary.yaml:3
    ✗ References agent "summarizer" but no agent with that name exists.
      Available agents: helper, file-reader, weather-bot

  paceline.yaml:12
    ✗ tool_grants references serviceaccount:reporter but it is not
      declared in service_accounts.

4 errors, 0 warnings. Fix these before deploying.
```

```
$ pace build
✓ Build succeeded
  3 agents, 1 loop, 2 tools
  Manifest: .pace/build/abc123.json
```

### What we build

- `pace build` command that runs the full validation pipeline
- Checks: model validation, MCP reachability (with timeout), tool path
  resolution, loop→agent refs, ACL consistency, service account declarations
- Content-addressed build manifest (hash of all resolved specs + bundled tools)
- Helpful error messages: source location, what's wrong, suggestion to fix
- Warning level for non-fatal issues (e.g., unused tool grants)

### What this proves

The "pit of success" — the build step is the primary error surface, not
production. Mistakes are caught early with actionable feedback.

---

## Milestone 5: Local Dev Stack

**Demo:** `pace run` stands up everything — all agents, web chat UI,
API server, trace viewer, hot-reload.

```
$ pace run

  ● API server    → http://localhost:3141/api
  ● Web UI        → http://localhost:3141
  ● Trace viewer  → http://localhost:3141/traces
  ● Watching for changes...

  Agents:
    helper        → http://localhost:3141/api/agents/helper/chat
    weather-bot   → http://localhost:3141/api/agents/weather-bot/chat

  Loops:
    (none yet — see Milestone 6)
```

The web UI lets you pick an agent and converse. The trace viewer shows
every invocation with tool calls, latency, and token counts. Edit a spec
file and the agent hot-reloads.

### What we build

- `packages/dev-server`: local server with API routes and web UI
- `pace run` discovers and starts all agents + loops from the project tree
- API routes: `/api/agents/[name]/chat` with streaming support
- Chat UI: agent picker, conversation view
- Trace viewer: structured invocation logs (agent, tools, latency, tokens)
- Hot-reload: Bun's native `--hot` for spec and tool changes
- `pace auth add <tool>` for local credential management
  (`.pace/credentials.local`, gitignored)
- Credential injection into MCP connections at invocation time

### What this proves

The local dev experience is first-class. You can iterate on agents as
fast as you iterate on web apps.

---

## Milestone 6: Scheduled Loops

**Demo:** Define a loop with a cron schedule. It fires automatically.
Trigger manually with instruction overrides.

```yaml
# loops/daily-digest.yaml
name: daily-digest
schedule: "0 9 * * *"
agent: helper
run_as: serviceaccount:digest-bot
instruction: |
  Summarize the top 3 Hacker News stories from today.
  Be concise — one sentence per story.
```

```
$ pace run
  ...
  Loops:
    daily-digest  → cron(0 9 * * *)  → helper

# In another terminal:
$ pace loop trigger daily-digest
🔄 Triggering daily-digest → helper
helper: Here are today's top HN stories:
  1. ...

$ pace loop trigger daily-digest --instruction "Just tell me the #1 story"
🔄 Triggering daily-digest → helper (instruction override)
helper: The top story today is...
```

### What we build

- Loop spec parser (name, schedule, agent, run_as, instruction, acl)
- Loop runner using node-cron (in `pace run`) or system cron (in `pace serve`)
- `pace loop trigger <name>` for manual invocation
- `--instruction` flag for override testing
- Loop invocations appear in the trace viewer
- Validate loops during `pace build` (agent refs, cron syntax, service accounts)

### What this proves

Agents aren't just chatbots — they're autonomous workers on schedules
with full auditability.

---

## Milestone 7: Multi-Agent Composition

**Demo:** Agent A calls Agent B via its MCP endpoint. Each agent enforces
its own ACLs.

```yaml
# agents/researcher/spec.yaml
name: researcher
model: gemini-2.5-pro
description: You research topics thoroughly using web search.
tools:
  - server: mcp://npx/@anthropic-ai/mcp-fetch
    access: read
acl:
  - principal: serviceaccount:orchestrator
    role: execute

# agents/orchestrator/spec.yaml
name: orchestrator
model: gemini-2.5-flash
description: |
  You coordinate research tasks. Use the researcher agent for
  deep dives and synthesize the results.
tools:
  - server: paceline://researcher
    access: read
```

```
$ pace chat orchestrator
You: Research the current state of AI agent frameworks
orchestrator: Let me delegate this to the researcher...
  [calls researcher via MCP → researcher searches the web → returns findings]
orchestrator: Based on my research, here's the landscape...
```

### What we build

- Every agent exposes an `/mcp` endpoint (MCP server interface)
- `paceline://` URL scheme for intra-project agent references (resolved
  by the runtime to the correct local or network address)
- Cross-agent ACL enforcement: calling principal checked against target
  agent's ACL
- Multi-agent traces: parent/child invocation linking in trace viewer

### What this proves

Agents compose like microservices. MCP is the universal protocol — same
security model, same observability, same spec format.

---

## Milestone 8: Production Server

**Demo:** `pace serve` runs your agents as a production-ready process.
Deploy it anywhere you can run Node.js.

```
$ pace build
✓ Build succeeded

$ pace serve
  Listening on :8080

  Agents:
    helper        → /agents/helper/chat
    orchestrator  → /agents/orchestrator/chat

  Loops:
    daily-digest  → cron(0 9 * * *)
```

```
$ curl -X POST http://localhost:8080/agents/helper/chat \
    -H "Content-Type: application/json" \
    -d '{"message": "Hello!"}'

{"response": "Hello! How can I help you?"}
```

Deploy with Docker, systemd, any PaaS — it's just a Bun process.

### What we build

- `pace serve` command: production server (no dev UI, no file watcher
  — just agents, loops, and API endpoints)
- Serves: `/agents/[name]/chat`, `/agents/[name]/chat/stream`,
  `/agents/[name]/mcp`, `/agents/[name]/status`
- Health check endpoint: `/health`
- Configurable via environment variables (port, log level, credential paths)
- Dockerfile in the starter template (Bun base image)
- Loop runner with proper signal handling and graceful shutdown
- Reads build manifest — requires `pace build` to have run first

### What this proves

Paceline agents are self-hostable. No managed platform required — deploy
anywhere you can run Bun.

---

## Milestone 9: Skills

**Demo:** Pull a skill from a registry, tools and prompt fragments are
injected into your agent. The spec allowlist has the final say.

```
$ pace skill add skills.sh/salesforce/crm@1.2
✓ Added salesforce/crm@1.2
  Tools: sf_query, sf_create_record, sf_update_record
  Updated skills.lock

$ cat skills.lock
salesforce/crm@1.2:
  integrity: sha256-abc123...
  tools:
    - sf_query (read)
    - sf_create_record (write)
    - sf_update_record (write)
```

```yaml
# agents/sales-helper/spec.yaml
name: sales-helper
model: gemini-2.5-flash
skills:
  - skills.sh/salesforce/crm@1.2
description: You help the sales team manage their Salesforce pipeline.
tools:
  # Only allow read tools from the skill — write tools are excluded
  - name: sf_query
    access: read
```

### What we build

- Skill resolution: fetch from registry URL, validate, extract tools + prompts
- `skills.lock`: integrity hashes, pinned versions
- `pace skill add/remove/update` commands
- Build step: resolve skills, inject tools and prompt fragments, enforce
  that the agent's `tools` allowlist is authoritative (skills can't grant
  tools the spec doesn't list)

### What this proves

Reusable capabilities are a first-class concept. Skills enrich agents but
the spec always has the final word on what's allowed.

---

## Milestone 10: ACL Enforcement

**Demo:** Different principals get different access. ACLs are defined in
specs and enforced at runtime.

```yaml
# paceline.yaml
service_accounts:
  - name: digest-bot

tool_grants:
  - tool: mcp://integrations.example.com/slack
    grants:
      - principal: serviceaccount:digest-bot
        access: write
      - principal: group:viewers
        access: read

# agents/notifier/spec.yaml
acl:
  - principal: group:ops-team
    role: execute
  - principal: user:connor
    role: execute
```

```
# Requests carry a principal (via token, header, or config).
# The runtime enforces two-step authorization:
#   1. Is the tool in the agent's allowlist? (capability check)
#   2. Does the principal have the required grant? (privilege check)
# Both must pass.
```

### What we build

- ACL enforcement middleware in the runtime (agent execute, loop
  execute/read, tool grants)
- Two-step privilege resolution: capability check + grant check
- Principal resolution: pluggable — from bearer token, request header,
  or local config
- Tool grant enforcement at tool dispatch (read/write per principal)
- `pace build` validates ACL consistency (known principals, declared
  service accounts, granted tools)
- ACL summary in `pace build` output: who can do what

### What this proves

Security is declarative and lives in git. No permission exists that isn't
in a reviewed YAML file.

---

## Milestone 11: Observability

**Demo:** Every invocation produces a structured trace. Query and inspect
them locally.

```
$ pace run
  ...
  Trace viewer  → http://localhost:3141/traces

# After some invocations:

Traces (last 1h):
┌──────────────────────────────────────────────────┐
│ ✓ helper      user:connor   320ms   142tok       │
│ ✓ daily-digest sa:digest    1.2s    890tok       │
│ ✗ file-reader  user:connor  err     0tok         │
│   └─ MCP timeout: filesystem server @ 30s        │
└──────────────────────────────────────────────────┘

# Click into an invocation → full trace:
#   tool calls with args, response, latency, read/write classification
```

### What we build

- Structured trace format: invocation ID, agent, principal, model,
  duration, tokens, tool call breakdown (server, access, latency, status)
- Trace storage: pluggable backend (SQLite locally, Postgres in production,
  or any adapter)
- Query interface: filter by agent, loop, time range, status, principal
- Trace viewer in `pace run` web UI (expanded from Milestone 5 stub)
- Trace export: JSON lines format for integration with external systems
- `pace serve` emits traces to configured backend

### What this proves

Agents are observable. When something goes wrong, you know exactly what
happened.

---

## Milestone 12: Self-Hosting

**Demo:** Containerize your agents, deploy to Kubernetes (or anywhere),
wire up persistence and telemetry to your existing infrastructure.

### What we build

- Production container image: multi-stage Dockerfile, Bun base, non-root,
  read-only filesystem, `HEALTHCHECK` wired to `/health`
- Helm chart for Kubernetes (`charts/paceline/`): Deployment, Service,
  Ingress, HPA, OTel sidecar config, Secret references
- Integration guides (`docs/self-hosting/`):
  - Persistence: connecting OTel export to Jaeger/Tempo/Datadog, SQLite
    for single-replica, Postgres for multi-replica
  - Credentials: env var injection, external secret managers (Vault,
    AWS Secrets Manager, k8s external-secrets operator), rotation
  - Health and lifecycle: readiness/liveness probes, graceful shutdown,
    in-flight draining, loop deduplication on restart
  - Networking: TLS termination, agent discovery across replicas, egress
  - Upgrades: content-addressed manifests → new image → rolling deploy → rollback by hash
  - Security hardening: non-root, read-only fs, network policies

### What this proves

Paceline agents run on your infrastructure, your way. No vendor lock-in.

---

## Milestone Summary

| #  | Milestone              | Key Dependency | Unlocks                          |
|----|------------------------|----------------|----------------------------------|
| 1  | Spec to Chat           | —              | Core spec format, first agent    |
| 2  | MCP Tools              | 1              | External tool integration        |
| 3  | Custom TypeScript Tools| 1              | Custom logic in agents           |
| 4  | Build System           | 2, 3           | Validation, error catching       |
| 5  | Local Dev Stack        | 4              | Web UI, hot-reload, traces       |
| 6  | Scheduled Loops        | 4              | Autonomous agent execution       |
| 7  | Multi-Agent            | 5              | Agent composition via MCP        |
| 8  | Production Server      | 4              | Self-hostable deployment         |
| 9  | Skills                 | 4              | Reusable capability bundles      |
| 10 | ACL Enforcement        | 8              | Authorization model              |
| 11 | Observability          | 8              | Structured traces, query, export |
| 12 | Self-Hosting           | 8, 10, 11      | Container, Helm, ops guides      |

## Dependency Graph

```
M1 → M2 ──→ M4 → M5 → M7
       ↗       ↘→ M6
    M3          ↘→ M8 → M10 ──→ M12
                ↘→ M9  ↘→ M11 ──↗
```

Milestones 2+3 can be parallelized. Milestones 5+6+8+9 can be
parallelized after Milestone 4. Milestones 10+11 can be parallelized
after Milestone 8. Milestone 12 follows once the production server,
ACLs, and observability are solid.

## Project Structure

```
my-project/
├── agents/
│   └── [name]/
│       └── spec.yaml
├── loops/
│   └── [name].yaml
├── tools/
│   └── [name].ts
├── skills/
│   └── [auto-populated]
├── skills.lock
└── paceline.yaml
```

## Technology

| Layer          | Choice                             |
|----------------|------------------------------------|
| Agent runtime  | Google ADK (TypeScript)             |
| Model support  | Gemini (via ADK, extensible)        |
| MCP            | ADK McpToolset                      |
| Spec parsing   | zod + yaml                          |
| Tool bundling  | Bun (native TS), esbuild (publish)  |
| Runtime        | Bun                                 |
| Scheduling     | node-cron (dev), system cron (prod)  |
| Traces         | OpenTelemetry, SQLite (dev), pluggable (prod) |
| Dev UI         | React                                |
