# Project Rules for AI Assistants

## Agent Loop Skill Development

When adding, modifying, or refactoring an agent-loop skill in this repository, follow this exact convention.

### Required Artifacts

Every new skill must include all of the following. Do not claim the work is complete until all are implemented and validated.

1. **Skill markdown**
   - Path: `skills/<skill-name>/SKILL.md`
   - Must include frontmatter: `name`, `description`, `argument-hint`, `allowed-tools`.
   - Must describe trigger conditions, workflow, tool input examples, and response rules.

2. **Tool implementation** (if the skill needs a new tool)
   - Path: `api/src/modules/agent-loop/tools/domain/<skill-name>/<skill-name>.ts`
   - Must export `build<ToolName>Tool(): ToolDefinition`.
   - Must define a Zod `inputSchema` with `.describe()` on every field.
   - Must set `kind: "domain"`, `isReadOnly`, `isDestructive`, `isConcurrencySafe`, and `riskLevel`.
   - Must throw on execution failure; do not return fake data.

3. **Tool registration**
   - Path: `api/src/modules/agent-loop/tools/domain/index.ts`
   - Import and register the new tool in `buildDomainTools()`.

4. **Smoke scenario helper**
   - Path: `api/scripts/agent-loop/agent-loop-smoke-<skill-name>.ts`
   - Must export:
     - `<UPPER_NAME>_SCENARIO`
     - `<UPPER_NAME>_TOOLS`
     - `<UPPER_NAME>_QUERY`
     - `create<ToolName>SmokeModelClient(): ModelClient`
     - `installMock<ToolName>Fetch(options)`
     - `validate<ToolName>Smoke(input)`
   - Follow the existing `agent-loop-smoke-gis.ts` and `agent-loop-smoke-daily-report.ts` patterns.

5. **Integration into `agent-loop-smoke.ts`**
   - Import the scenario helper.
   - Add the scenario to `knownScenarios`.
   - Add tool defaults, fake model selection, mock fetch selection, and validation branches.

6. **Unit / integration test**
   - Path: `api/tests/agent-loop/test-<skill-name>-tool.mjs`
   - Must test:
     - Tool registration in the default registry
     - Input schema validation (valid, default, invalid)
     - Successful execution with mocked external API
     - Failure handling (network error, HTTP error)
     - Fake model client first and second decisions
     - Smoke validation function

7. **package.json scripts**
   - In `api/package.json`, add:
     ```json
     "agent:smoke:<skill-name>": "tsx scripts/agent-loop/agent-loop-smoke.ts --scenario <skill-name> --mock-api",
     "agent:smoke:<skill-name>:real": "tsx scripts/agent-loop/agent-loop-smoke.ts --scenario <skill-name>"
     ```

### Templates

Use the templates in `docs/templates/agent-loop-skill/` as the starting point:

- `SKILL.md.template`
- `tool.ts.template`
- `smoke-helper.ts.template`
- `tool-test.mjs.template`

Replace all `<...>` placeholders with concrete names before implementing.

### Validation Checklist

Before finishing, run and confirm all pass:

```bash
cd api
pnpm tsc --noEmit
npx tsx tests/agent-loop/test-<skill-name>-tool.mjs
pnpm agent:smoke:<skill-name>
```

If the skill depends on an external service, also verify the real path once:

```bash
pnpm agent:smoke:<skill-name>:real
```

### Prohibited Patterns

- Do **not** create standalone smoke scripts that bypass `agent-loop-smoke.ts`. All scenario smoke tests must go through `runAgentLoopEvents` so they produce turn-level logs, file logs, and database task records.
- Do **not** add `console.log` only smoke runners. If a script only prints summary output without using `runAgentLoopEvents`, it does not conform.
- Do **not** omit the fake model client. Every scenario must be runnable in CI without calling a real LLM.
- Do **not** skip the unit test. Every new tool must have a `test-<skill-name>-tool.mjs` that can run offline.

### Existing Examples

Reference these implementations when in doubt:

- `skills/daily-report/SKILL.md`
- `api/src/modules/agent-loop/tools/domain/dailyReport/dailyReport.ts`
- `api/src/modules/agent-loop/tools/domain/index.ts`
- `api/scripts/agent-loop/agent-loop-smoke-daily-report.ts`
- `api/scripts/agent-loop/agent-loop-smoke.ts`
- `api/tests/agent-loop/test-daily-report-tool.mjs`
- `api/package.json` (search for `agent:smoke:daily-report`)
