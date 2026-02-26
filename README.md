# Paceline

Paceline is a spec-driven framework for building, running, and deploying
AI agents. Define agents in YAML, wire in tools via MCP, schedule
autonomous loops, and ship to production — all from a single project
directory versioned in git.

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

## Why Paceline

There's a gap between no-code agent builders and raw agent frameworks.
No-code tools handle greenfield apps but break down when you need version
control, code review, and production infrastructure. Raw frameworks give
you full control but leave deployment, scheduling, security, and
observability as exercises for the reader.

Paceline fills this gap. It is to agent development what build tools like
Vite are to web development: an opinionated, spec-driven workflow that
catches errors early, provides a great local dev experience, and produces
artifacts you can deploy anywhere.

**Specs are canonical.** Everything — behavior, tools, permissions,
schedules — lives in YAML files in git. No config drift. No permissions
diverging from reviewed deployments.

**Build catches errors early.** Invalid tool references, missing agents,
undeclared service accounts — all caught at `pace build` before anything
reaches production.

**Preview before shipping.** Write tools are stubbed by default so you
can observe agent behavior before enabling live side effects.

**Self-hostable.** `pace serve` runs your agents as a standard Bun
process. Deploy with Docker, Kubernetes, or any platform that runs
containers.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) (v1.1+)
- A [Google AI API key](https://aistudio.google.com/apikey) for Gemini

### Create a project

```bash
pace init my-agents
cd my-agents
export GOOGLE_API_KEY="your-key-here"
```

This scaffolds the canonical project structure:

```
my-agents/
├── agents/
│   └── helper/
│       └── spec.yaml
├── paceline.yaml
├── package.json
└── .gitignore
```

### Chat with your agent

Interactive mode:

```bash
pace chat helper
```

Pipe mode (for scripting and CI):

```bash
echo "Summarize this README" | pace chat helper
```

### Add tools

Agents can use MCP servers and custom TypeScript functions:

```yaml
# agents/file-reader/spec.yaml
name: file-reader
model: gemini-2.5-flash
description: You help users understand codebases.
tools:
  - server: mcp://npx/@anthropic-ai/mcp-filesystem
    access: read
```

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

### Validate everything

```bash
pace build
```

The build step validates all specs — model names, tool references, loop
schedules, ACL consistency — and produces a content-addressed manifest.

### Run the full dev stack

```bash
pace run
```

Starts all agents, loops, a web chat UI, API server, and trace viewer
at `http://localhost:3141`. Specs hot-reload on save.

### Schedule autonomous loops

```yaml
# loops/daily-digest.yaml
name: daily-digest
schedule: "0 9 * * *"
agent: helper
run_as: serviceaccount:digest-bot
instruction: |
  Summarize the top 3 Hacker News stories from today.
```

```bash
pace loop trigger daily-digest
```

### Deploy to production

```bash
pace build
pace serve
```

`pace serve` runs your agents as a production-ready Bun process — no dev
UI, no file watcher, just agents, loops, and API endpoints. Containerize
it and deploy anywhere.

## CLI Reference

| Command                          | Purpose                              |
|----------------------------------|--------------------------------------|
| `pace init [dir]`                | Scaffold a new project               |
| `pace chat <agent>`              | Chat with a single agent (TTY-aware) |
| `pace build`                     | Validate specs, emit build manifest  |
| `pace run`                       | Start all agents, loops, web UI, API |
| `pace serve`                     | Run production server                |
| `pace loop trigger <name>`       | Manually fire a loop                 |
| `pace auth add <tool>`           | Store local credentials              |
| `pace skill add <ref>`           | Add a skill from a registry          |

## Project Structure

```
my-project/
├── agents/
│   └── [name]/
│       └── spec.yaml       # Agent definition
├── loops/
│   └── [name].yaml          # Scheduled agent invocations
├── tools/
│   └── [name].ts            # Custom TypeScript tools
├── skills/
│   └── [auto-populated]     # Installed skill definitions
├── skills.lock               # Pinned skill versions
└── paceline.yaml             # Project config: service accounts, tool grants
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — how paceline works under the hood
- [Roadmap](ROADMAP.md) — milestone-driven development plan

## Technology

| Layer          | Choice                                         |
|----------------|------------------------------------------------|
| Agent runtime  | [Google ADK](https://github.com/google/adk-js) |
| Models         | Gemini (via ADK, extensible)                    |
| Tool protocol  | [MCP](https://modelcontextprotocol.io)          |
| Skills         | [Anthropic skill format](https://skills.sh)     |
| Spec parsing   | zod + yaml                                      |
| Runtime        | [Bun](https://bun.sh)                           |
| Traces         | [OpenTelemetry](https://opentelemetry.io)       |

## License

Apache 2.0 — see [LICENSE](LICENSE).
