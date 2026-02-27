import { z } from "zod";

export const SUPPORTED_MODELS = [
	"gemini-2.5-flash",
	"gemini-2.5-pro",
	"gemini-3-flash-preview",
] as const;

// -- Tool entries (two forms) --

const mcpToolSchema = z.object({
	server: z.string().min(1),
	access: z.enum(["read", "write"]),
});

const localToolSchema = z.object({
	name: z.string().min(1),
	access: z.enum(["read", "write"]),
});

export const toolSchema = z.union([mcpToolSchema, localToolSchema]);

// -- ACL entries --

export const aclEntrySchema = z.object({
	principal: z.string().min(1),
	role: z.enum(["execute", "read"]),
});

// -- Agent spec --

export const agentSpecSchema = z.object({
	name: z
		.string()
		.min(1, "Agent name is required")
		.regex(
			/^[a-z0-9][a-z0-9-]*$/,
			"Agent name must be lowercase alphanumeric with hyphens, starting with a letter or digit",
		),
	model: z.enum(SUPPORTED_MODELS, {
		errorMap: (_issue, ctx) => ({
			message: `Unknown model "${ctx.data}". Supported: ${SUPPORTED_MODELS.join(", ")}`,
		}),
	}),
	description: z.string().min(1, "Agent description is required"),
	tools: z.array(toolSchema).optional(),
	skills: z.array(z.string().min(1)).optional(),
	acl: z.array(aclEntrySchema).optional(),
});

export type AgentSpec = z.infer<typeof agentSpecSchema>;
export type ToolEntry = z.infer<typeof toolSchema>;
export type AclEntry = z.infer<typeof aclEntrySchema>;
