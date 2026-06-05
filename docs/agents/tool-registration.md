# Agent Loop Tool Registration

This note records the tool registration pattern for `api/src/modules/agent-loop`.
It is intentionally lighter than Claude Code's full `Tool` protocol, but keeps
the same core boundary: the loop manages runtime policy, while each tool
declares enough metadata for safe scheduling and review.

## ToolDefinition contract

Every callable tool is registered as a `ToolDefinition` from
`api/src/modules/agent-loop/types.ts`.

Required fields:

- `name`: stable model-facing name.
- `description`: concise model-facing description.
- `inputSchema`: Zod schema for model arguments.
- `execute(input, context)`: the side-effecting implementation.

Recommended fields for all non-trivial tools:

- `kind`: `system`, `skill`, or `mcp`.
- `isReadOnly(input)`: true when the call only reads state.
- `isDestructive(input)`: true when the call may write, delete, execute, or mutate state.
- `isConcurrencySafe(input)`: true only when calls can run beside other safe calls.
- `riskLevel`: `low`, `medium`, or `high`.
- `validateInput(input, context)`: semantic validation after schema parsing.
- `checkPermissions(input, context)`: allow, deny, or ask before execution.
- `maxResultSizeChars`: storage/model-visible output budget.
- `aliases`: optional legacy names that resolve to the same tool.

The gateway executes tools in this order:

```text
lookup by name/alias
  -> schema validation
  -> semantic validateInput
  -> abort check
  -> checkPermissions
  -> execute(input, context)
  -> result budget normalization
  -> ToolObservation
```

## Registration sources

### System tools

System tools are registered by `registerClaudeCodeBaseSystemTools()` in
`systemTools.ts`, which is called by `buildDefaultToolRegistry()`.

Use this for built-in runtime tools such as `Read`, `Grep`, `Bash`, `Edit`, and
future first-party GIS/domain tools. Built-ins should keep stable names because
the model sees them directly.

### Skill tools

Skill tools should be wrapped into `ToolDefinition` objects with `kind: "skill"`.
Do not let a skill bypass the gateway by calling implementation code directly.

Recommended registration pattern:

```ts
export function registerSkillTools(registry: ToolRegistry, skills: SkillDefinition[]) {
  for (const skill of skills) {
    registry.register(toSkillToolDefinition(skill));
  }
}
```

For skills, always classify:

- read-only lookup/summarization skills: `isReadOnly: true`, `riskLevel: "low"`.
- file-writing or task-mutating skills: `isDestructive: true`, `riskLevel: "high"`.
- external API skills: usually `riskLevel: "medium"` unless they mutate remote state.
- user-question skills: `requiresUserInteraction: true`, `isConcurrencySafe: false`.

### MCP tools

MCP tools should be wrapped into `ToolDefinition` objects with `kind: "mcp"`.
The wrapper should map the MCP tool schema into Zod, then use `checkPermissions`
to enforce server/tool allow or deny rules before execution.

Built-in tools have priority. If a third-party tool has the same name as a
built-in, do not override it unless the caller explicitly opts into
`registry.register(tool, { override: true })`.

## Scheduling rules

The loop only runs consecutive `isConcurrencySafe(input) === true` calls in a
concurrent batch. All other tools are serialized. This keeps the default
fail-closed for new skills: if a tool author does not declare concurrency safety,
the loop treats it as unsafe.

Useful defaults:

- read/search tools: concurrent.
- writes, edits, shell commands, user interaction: sequential.
- external API reads: concurrent only when rate limits and ordering do not matter.

## Permission rules

`checkPermissions` currently supports three decisions:

- `allow`: execute immediately.
- `deny`: return a `permission_denied` observation to the model.
- `ask`: return a `permission_required` observation until an interactive approval
  path exists.

This keeps today's backend non-interactive behavior stable while leaving a clean
slot for future approval UI.

## Runtime context

`ToolExecutionContext` contains:

- `taskId`
- `query`
- prior `observations`
- optional `signal`
- optional `onProgress(event)`

Long-running skills should observe `signal` and emit progress with
`onProgress`. The gateway fills in `toolCallId` and `toolName` when omitted.

## Context-window invariants

`ContextWindowManager` may truncate content and remove old message groups, but it must preserve tool-call adjacency:

- If an assistant message with `toolCalls` remains, its matching `tool` messages must remain immediately after it.
- A tool result must not remain without the assistant tool call that created it.
- The latest user request must remain.
- The system message should remain unless a future prompt manager deliberately replaces it.

When a tool result is too large for the active context budget, `ContextWindowManager`
may replace it with a preview plus truncation metadata. The metadata must include
the tool name, tool call id when available, original character count, kept character
count, and omitted character count. Future persistent tool-result storage should use
the same metadata shape when it adds external reference handles.

