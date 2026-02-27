import { parse as parseYaml } from "yaml";
import type { ZodError } from "zod";
import { type AgentSpec, agentSpecSchema } from "./schema.js";

export class SpecParseError extends Error {
	public readonly issues: string[];

	constructor(issues: string[]) {
		super(`Invalid agent spec:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
		this.name = "SpecParseError";
		this.issues = issues;
	}
}

function formatZodIssues(error: ZodError): string[] {
	return error.issues.map((issue) => {
		const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
		return `${path}: ${issue.message}`;
	});
}

/**
 * Parse a YAML string into a validated AgentSpec.
 * Throws SpecParseError with clear, formatted messages on validation failure.
 */
export function parseAgentSpec(yamlContent: string): AgentSpec {
	let raw: unknown;
	try {
		raw = parseYaml(yamlContent);
	} catch (err) {
		throw new SpecParseError([
			`YAML syntax error: ${err instanceof Error ? err.message : String(err)}`,
		]);
	}

	if (raw === null || raw === undefined || typeof raw !== "object") {
		throw new SpecParseError([
			"Expected a YAML mapping, got a scalar or empty document",
		]);
	}

	const result = agentSpecSchema.safeParse(raw);
	if (!result.success) {
		throw new SpecParseError(formatZodIssues(result.error));
	}

	return result.data;
}
