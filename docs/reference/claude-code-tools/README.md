# Claude Code Tools Reference

This directory is a source snapshot copied from `claude-code-analysis/src`.

- `tools.ts` contains the built-in tool pool assembly logic.
- `Tool.ts` contains the common tool protocol and default behavior.
- `tools/` contains the individual tool implementations and prompts.

This snapshot is for reference while building `api/src/modules/agent-loop`.
It is not imported by the API runtime and is not the executable gateway registry.
Only tools registered in `ToolRegistry` can be called by the current agent loop.
