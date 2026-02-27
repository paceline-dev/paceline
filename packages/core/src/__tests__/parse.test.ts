import { describe, expect, it } from "bun:test";
import { SpecParseError, parseAgentSpec } from "../parse.js";

describe("parseAgentSpec", () => {
	it("parses a minimal valid spec", () => {
		const spec = parseAgentSpec(`
name: helper
model: gemini-2.5-flash
description: You are a helpful assistant.
`);
		expect(spec).toEqual({
			name: "helper",
			model: "gemini-2.5-flash",
			description: "You are a helpful assistant.",
		});
	});

	it("parses a spec with all optional fields", () => {
		const spec = parseAgentSpec(`
name: file-reader
model: gemini-2.5-pro
description: You help users understand codebases.
tools:
  - server: mcp://npx/@anthropic-ai/mcp-filesystem
    access: read
  - name: tools/custom-tool
    access: write
skills:
  - skills.sh/namespace/skill@1.0
acl:
  - principal: group:engineering
    role: execute
  - principal: serviceaccount:orchestrator
    role: read
`);
		expect(spec.name).toBe("file-reader");
		expect(spec.model).toBe("gemini-2.5-pro");
		expect(spec.tools).toHaveLength(2);
		expect(spec.tools?.[0]).toEqual({
			server: "mcp://npx/@anthropic-ai/mcp-filesystem",
			access: "read",
		});
		expect(spec.tools?.[1]).toEqual({
			name: "tools/custom-tool",
			access: "write",
		});
		expect(spec.skills).toEqual(["skills.sh/namespace/skill@1.0"]);
		expect(spec.acl).toHaveLength(2);
	});

	it("rejects an unknown model with a helpful message", () => {
		expect(() =>
			parseAgentSpec(`
name: helper
model: gpt-5
description: test
`),
		).toThrow(
			'Unknown model "gpt-5". Supported: gemini-2.5-flash, gemini-2.5-pro, gemini-3-flash-preview',
		);
	});

	it("rejects a missing name", () => {
		expect(() =>
			parseAgentSpec(`
model: gemini-2.5-flash
description: test
`),
		).toThrow("name");
	});

	it("rejects a missing description", () => {
		expect(() =>
			parseAgentSpec(`
name: helper
model: gemini-2.5-flash
`),
		).toThrow("description");
	});

	it("rejects invalid agent name format", () => {
		expect(() =>
			parseAgentSpec(`
name: My Agent!
model: gemini-2.5-flash
description: test
`),
		).toThrow("lowercase alphanumeric");
	});

	it("rejects invalid YAML", () => {
		expect(() => parseAgentSpec("key: [unterminated")).toThrow(
			"YAML syntax error",
		);
	});

	it("rejects empty document", () => {
		expect(() => parseAgentSpec("")).toThrow("Expected a YAML mapping");
	});

	it("rejects a scalar document", () => {
		expect(() => parseAgentSpec("just a string")).toThrow(
			"Expected a YAML mapping",
		);
	});

	it("throws SpecParseError with issues array", () => {
		try {
			parseAgentSpec(`
name: helper
model: bad-model
description: test
`);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(SpecParseError);
			expect((err as SpecParseError).issues.length).toBeGreaterThan(0);
		}
	});

	it("rejects invalid tool access level", () => {
		expect(() =>
			parseAgentSpec(`
name: helper
model: gemini-2.5-flash
description: test
tools:
  - server: mcp://example
    access: admin
`),
		).toThrow(SpecParseError);
	});

	it("rejects invalid acl role", () => {
		expect(() =>
			parseAgentSpec(`
name: helper
model: gemini-2.5-flash
description: test
acl:
  - principal: user:connor
    role: admin
`),
		).toThrow(SpecParseError);
	});
});
