# Scenario Skill Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a scenario profile switcher that changes ChatPanel copy, quick demo actions, map baseline layers, and backend Skill availability through one shared configuration.

**Architecture:** `packages/shared` owns the scenario profiles so frontend, backend, and Skill Gallery use one source of truth. `HomePage` owns `activeScenarioId` and passes the resolved profile into ChatPanel, map filtering, and task creation. The backend receives `scenarioId`, stores it in Agent Loop runtime context, filters skill listings, and rejects `Skill(...)` calls outside the active scenario.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, shared workspace package `@datasourceintelligence/shared`, Express backend under `api/src`, local markdown skills under `skills/*/SKILL.md`, CesiumJS map rendering.

## Global Constraints

- The scenario configuration is defined once in `packages/shared/src/scenarios.ts`.
- This phase limits Skill availability only at the `Skill` layer; it does not restrict lower-level domain tools such as `SqlQuery`, `RegionResolve`, `SatelliteImageSearch`, or mock assessment tools.
- Chat history is preserved across scenario changes.
- Each scenario change inserts a system separator message into the existing chat stream.
- Scenario changes clear current map selections and active task/event GIS overlays, but they do not clear chat messages.
- Open-source intelligence (`osint`) is the default scenario.
- Skill Gallery shows project-local skills only, as already implemented.
- Skill Gallery scenario usage is derived from shared scenario profiles, not duplicated UI mappings.
- Existing global user skills under `C:\Users\24219\.agents\skills` stay out of scope.
- `fire-investigation` is enabled in both `emergency` and `border` scenarios.
- `flood-assessment`, `csv-profile`, and `conventional-commit-helper` are not assigned to the four business scenarios in this phase.
- Do not manually edit generated `packages/shared/dist/*`; run the shared build when declarations need verification.

---

## File Structure

- Create `packages/shared/src/scenarios.ts`
  - Owns `ScenarioId`, `ScenarioProfile`, quick actions, map layer ids, skill ids, and helper functions.
- Modify `packages/shared/src/index.ts`
  - Re-exports scenario types and helpers.
- Modify `packages/shared/src/types/task.ts`
  - Adds optional `scenarioId` to `CreateTaskRequest`.
- Create `api/scripts/test-scenarios-shared.ts`
  - Verifies profile ids, default scenario, skill usage reverse lookup, and request schema parsing.
- Modify `src/types/skillCatalog.ts`
  - Changes `loadedByScenarios` from `string[]` to structured `{ id, name }[]`.
- Modify `src/lib/skillCatalog.server.ts`
  - Populates `loadedByScenarios` from shared scenario profiles.
- Modify `src/components/skills/SkillCard.tsx`
  - Shows compact scenario usage badges.
- Modify `src/components/skills/SkillDetailDrawer.tsx`
  - Shows scenario usage in the drawer.
- Modify `api/scripts/test-skills-catalog.ts`
  - Asserts scenario usage is present for mapped skills and absent for unmapped skills.
- Create `src/components/chat/ScenarioSwitcher.tsx`
  - Provides the ChatPanel scenario selection UI above the input.
- Modify `src/components/ChatPanel.tsx`
  - Accepts scenario props, inserts system separator messages on scenario change, passes quick actions and copy to children.
- Modify `src/components/chat/ChatHeader.tsx`
  - Accepts title and subtitle props.
- Modify `src/components/chat/ChatMessageList.tsx`
  - Accepts empty-state copy and quick actions, renders system separator messages.
- Modify `src/components/chat/ChatInput.tsx`
  - Accepts scenario-specific placeholder.
- Modify `src/types/prd.ts`
  - Extends `ChatMessage.role` with `system`.
- Create `api/scripts/test-scenario-chat.tsx`
  - Smoke-tests ChatPanel wiring and system separator helper behavior.
- Modify `src/app/page.tsx`
  - Owns `activeScenarioId`, filters baseline map entities and trajectories, clears map overlays on scenario change, passes scenario id to task creation.
- Modify `src/lib/api.ts`
  - Extends `createAgentTask(query, options)` to send `scenarioId`.
- Create `api/scripts/test-scenario-map-and-api.ts`
  - Verifies map filtering helpers and create-task request body behavior.
- Modify `api/src/modules/agent-loop/tools/_shared/types.ts`
  - Adds `scenarioId?: ScenarioId` to `AgentLoopToolUseContext`.
- Modify `api/src/modules/agent-loop/runAgentLoop.ts`
  - Adds `scenarioId?: ScenarioId` to options and tool-use context creation/update.
- Modify `api/src/modules/tasks/pipeline.ts`
  - Passes `body.scenarioId` into `runAgentLoop`.
- Modify `api/src/modules/agent-loop/skillManager.ts`
  - Filters listing sections by scenario and rejects disallowed `Skill` calls.
- Create `api/scripts/agent-loop/agent-loop-scenario-skill-filter-test.ts`
  - Verifies backend skill filtering and call rejection without invoking a real model.

---

## Scenario Profiles

The initial profiles are:

| id | name | baseline map layers | enabled skills |
| --- | --- | --- | --- |
| `osint` | 开源情报分析 | `ais`, `ads` | `ais-region-query`, `aircraft-region-query` |
| `marine` | 海洋 | none | `oil-spill-tracing`, `ais-region-query` |
| `emergency` | 应急 | none | `disaster-satellite-query`, `earthquake-assessment`, `fire-investigation` |
| `border` | 边防 | none | `border-defense-qa`, `daily-report`, `alarm-disposal-orchestrator`, `fire-investigation` |

The default scenario is `osint`.

---

### Task 1: Shared Scenario Profiles And Task Schema

**Files:**
- Create: `packages/shared/src/scenarios.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/types/task.ts`
- Test: `api/scripts/test-scenarios-shared.ts`

**Interfaces:**
- Produces:
  - `ScenarioIdSchema`
  - `type ScenarioId`
  - `type ScenarioMapLayerId`
  - `interface ScenarioQuickAction`
  - `interface ScenarioProfile`
  - `DEFAULT_SCENARIO_ID`
  - `SCENARIOS`
  - `isScenarioId(value: unknown): value is ScenarioId`
  - `getScenarioProfile(value?: unknown): ScenarioProfile`
  - `getSkillScenarioUsage(skillId: string): Array<Pick<ScenarioProfile, "id" | "name">>`
  - `CreateTaskRequest` accepts optional `scenarioId`
- Consumes:
  - Existing shared package build and exports.

- [ ] **Step 1: Write the failing shared scenario test**

Create `api/scripts/test-scenarios-shared.ts`:

```typescript
import { strict as assert } from "node:assert";
import {
  CreateTaskRequest,
  DEFAULT_SCENARIO_ID,
  SCENARIOS,
  getScenarioProfile,
  getSkillScenarioUsage,
  isScenarioId,
} from "@datasourceintelligence/shared";

const scenarioIds = SCENARIOS.map((scenario) => scenario.id);

assert.deepEqual(scenarioIds, ["osint", "marine", "emergency", "border"]);
assert.equal(DEFAULT_SCENARIO_ID, "osint");
assert.equal(getScenarioProfile(undefined).id, "osint");
assert.equal(getScenarioProfile("marine").name, "海洋");
assert.equal(getScenarioProfile("not-real").id, "osint");
assert.equal(isScenarioId("border"), true);
assert.equal(isScenarioId("unknown"), false);

assert.deepEqual(
  getSkillScenarioUsage("fire-investigation").map((scenario) => scenario.id),
  ["emergency", "border"],
);
assert.deepEqual(
  getSkillScenarioUsage("oil-spill-tracing").map((scenario) => scenario.id),
  ["marine"],
);
assert.deepEqual(getSkillScenarioUsage("csv-profile"), []);

const parsed = CreateTaskRequest.parse({
  query: "查询东海船舶态势",
  userId: "agent-loop-local-user",
  scenarioId: "osint",
});
assert.equal(parsed.scenarioId, "osint");

const fallbackParsed = CreateTaskRequest.parse({
  query: "没有场景也可以创建任务",
});
assert.equal(fallbackParsed.scenarioId, undefined);

assert.throws(() => {
  CreateTaskRequest.parse({ query: "非法场景", scenarioId: "invalid" });
});

console.log("PASS shared scenario profiles");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/test-scenarios-shared.ts
```

Expected: FAIL with a missing export for `DEFAULT_SCENARIO_ID` or `SCENARIOS`.

- [ ] **Step 3: Create shared scenario profiles**

Create `packages/shared/src/scenarios.ts`:

```typescript
import { z } from "zod";

export const ScenarioIdSchema = z.enum(["osint", "marine", "emergency", "border"]);
export type ScenarioId = z.infer<typeof ScenarioIdSchema>;

export const ScenarioMapLayerIdSchema = z.enum(["ais", "ads"]);
export type ScenarioMapLayerId = z.infer<typeof ScenarioMapLayerIdSchema>;

export interface ScenarioQuickAction {
  label: string;
  prompt: string;
}

export interface ScenarioProfile {
  id: ScenarioId;
  name: string;
  description: string;
  chatTitle: string;
  chatSubtitle: string;
  greetingTitle: string;
  greetingDescription: string;
  inputPlaceholder: string;
  switchMessage: string;
  quickActions: ScenarioQuickAction[];
  mapLayers: ScenarioMapLayerId[];
  skillIds: string[];
}

export const DEFAULT_SCENARIO_ID: ScenarioId = "osint";

export const SCENARIOS: readonly ScenarioProfile[] = [
  {
    id: "osint",
    name: "开源情报分析",
    description: "整合互联网舆情工具、开源船舶数据和开源航班数据，支撑统一检索与关联分析。",
    chatTitle: "开源情报分析助手",
    chatSubtitle: "船舶、航班与公开信息关联检索",
    greetingTitle: "您好，我是开源情报分析助手",
    greetingDescription: "我可以帮您检索 AIS 船舶、ADS-B 航班与区域态势，并支持后续舆情关联分析。",
    inputPlaceholder: "输入船舶、航班、区域或开源情报问题...",
    switchMessage: "已切换到「开源情报分析」场景，当前将优先使用船舶、航班与开源检索能力。",
    quickActions: [
      {
        label: "东海船舶态势",
        prompt: "查询东海区域 AIS 船舶态势，统计船舶数量、类型和异常目标。",
      },
      {
        label: "华东航班态势",
        prompt: "查询华东区域 ADS-B 航班态势，统计空中航空器数量和异常信号。",
      },
    ],
    mapLayers: ["ais", "ads"],
    skillIds: ["ais-region-query", "aircraft-region-query"],
  },
  {
    id: "marine",
    name: "海洋",
    description: "围绕漏油排查场景，构建油污识别、漂移推演、嫌疑船匹配与溯源能力。",
    chatTitle: "海洋漏油排查助手",
    chatSubtitle: "油污识别、漂移推演与嫌疑船溯源",
    greetingTitle: "您好，我是海洋漏油排查助手",
    greetingDescription: "我可以帮您触发油污溯源演示，并结合海事目标进行嫌疑船关联分析。",
    inputPlaceholder: "输入漏油、油膜、漂移或海事溯源问题...",
    switchMessage: "已切换到「海洋」场景，当前将优先使用漏油识别、溯源和海事关联分析能力。",
    quickActions: [
      {
        label: "东海油污溯源演示",
        prompt: "/演示:油污溯源 中国东海 2026-06-01 疑似溢油",
      },
      {
        label: "嫌疑船关联分析",
        prompt: "围绕东海疑似油膜区域，分析周边 AIS 船舶并给出嫌疑船排序。",
      },
    ],
    mapLayers: [],
    skillIds: ["oil-spill-tracing", "ais-region-query"],
  },
  {
    id: "emergency",
    name: "应急",
    description: "联动互联网灾情检索与天机影像能力，串接地震、火灾场景的 Skill 链。",
    chatTitle: "应急灾情研判助手",
    chatSubtitle: "灾情检索、天机影像与损毁评估",
    greetingTitle: "您好，我是应急灾情研判助手",
    greetingDescription: "我可以帮您触发地震、火灾灾后评估链路，并在地图上展示受灾区域与影像结果。",
    inputPlaceholder: "输入地震、火灾、灾情影像或应急决策问题...",
    switchMessage: "已切换到「应急」场景，当前将优先使用灾情检索、天机影像和灾后评估能力。",
    quickActions: [
      {
        label: "Kensai 火情研判演示",
        prompt: "/演示:火情研判 Kensai 森林火灾",
      },
      {
        label: "柳州地震灾后评估演示",
        prompt: "/演示:地震灾后评估 广西柳州市柳南区 6.2级地震",
      },
    ],
    mapLayers: [],
    skillIds: ["disaster-satellite-query", "earthquake-assessment", "fire-investigation"],
  },
  {
    id: "border",
    name: "边防",
    description: "基于多源边防数据生成日报和分析材料，并复用火情识别能力加强边境区域监测。",
    chatTitle: "边防态势分析助手",
    chatSubtitle: "边防数据问答、日报生成与告警处置",
    greetingTitle: "您好，我是边防态势分析助手",
    greetingDescription: "我可以帮您查询边防告警与设备数据、生成日报，并触发火情识别能力支撑边境监测。",
    inputPlaceholder: "输入边防告警、设备、日报或巡逻处置问题...",
    switchMessage: "已切换到「边防」场景，当前将优先使用边防数据问答、日报生成和告警处置能力。",
    quickActions: [
      {
        label: "生成今日边防日报",
        prompt: "生成今天的边防安防日报，报告类型为总体。",
      },
      {
        label: "边境火情识别演示",
        prompt: "/演示:火情研判 Kensai 森林火灾",
      },
    ],
    mapLayers: [],
    skillIds: ["border-defense-qa", "daily-report", "alarm-disposal-orchestrator", "fire-investigation"],
  },
];

export function isScenarioId(value: unknown): value is ScenarioId {
  return ScenarioIdSchema.safeParse(value).success;
}

export function getScenarioProfile(value?: unknown): ScenarioProfile {
  const scenarioId = isScenarioId(value) ? value : DEFAULT_SCENARIO_ID;
  return SCENARIOS.find((scenario) => scenario.id === scenarioId) ?? SCENARIOS[0];
}

export function getSkillScenarioUsage(skillId: string): Array<Pick<ScenarioProfile, "id" | "name">> {
  return SCENARIOS
    .filter((scenario) => scenario.skillIds.includes(skillId))
    .map(({ id, name }) => ({ id, name }));
}
```

- [ ] **Step 4: Export scenarios from shared package**

Modify `packages/shared/src/index.ts`:

```typescript
export * from "./scenarios.js";
export * from "./types/task.js";
export * from "./types/plan.js";
export * from "./types/action.js";
export * from "./types/camera.js";
export * from "./types/maritime.js";
export * from "./types/agent-loop.js";
```

- [ ] **Step 5: Add `scenarioId` to task request schema**

Modify `packages/shared/src/types/task.ts`:

```typescript
import { z } from "zod";
import { ScenarioIdSchema } from "../scenarios.js";
import type { Plan } from "./plan.js";
import type { Action } from "./action.js";

export const TaskStatus = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const StepStatus = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
]);
export type StepStatus = z.infer<typeof StepStatus>;

export const CreateTaskRequest = z.object({
  query: z.string().min(1),
  userId: z.string().min(1).optional(),
  scenarioId: ScenarioIdSchema.optional(),
  context: z.record(z.string(), z.any()).optional(),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>;
```

Keep the existing exported `Task`, `TaskStep`, and `TaskWithSteps` interfaces below this block unchanged.

- [ ] **Step 6: Build shared package**

Run:

```powershell
& 'S:\Projects\projects_new\node_modules\.bin\tsc.cmd' -p packages/shared/tsconfig.json
```

Expected: PASS and updates generated files under `packages/shared/dist`.

- [ ] **Step 7: Run shared scenario test**

Run:

```powershell
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/test-scenarios-shared.ts
```

Expected: PASS and prints `PASS shared scenario profiles`.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/scenarios.ts packages/shared/src/index.ts packages/shared/src/types/task.ts packages/shared/dist api/scripts/test-scenarios-shared.ts
git commit -m "feat(scenarios): add shared scenario profiles"
```

---

### Task 2: Skill Catalog Scenario Usage

**Files:**
- Modify: `src/types/skillCatalog.ts`
- Modify: `src/lib/skillCatalog.server.ts`
- Modify: `src/components/skills/SkillCard.tsx`
- Modify: `src/components/skills/SkillDetailDrawer.tsx`
- Modify: `api/scripts/test-skills-catalog.ts`
- Modify: `api/scripts/test-skill-components.tsx`

**Interfaces:**
- Consumes:
  - `getSkillScenarioUsage(skillId: string)` from Task 1.
- Produces:
  - `SkillCatalogScenarioUsage`
  - `SkillCatalogItem.loadedByScenarios: SkillCatalogScenarioUsage[]`
  - Skill cards and drawer show scenario badges when usage exists.

- [ ] **Step 1: Update the catalog test first**

Modify `api/scripts/test-skills-catalog.ts` after the existing `items` load:

```typescript
  const oilSpill = items.find((item) => item.name === "oil-spill-tracing");
  assert.ok(oilSpill, "oil-spill-tracing should be discovered");
  assert.deepEqual(
    oilSpill.loadedByScenarios.map((scenario) => scenario.id),
    ["marine"],
  );

  const fire = items.find((item) => item.name === "fire-investigation");
  assert.ok(fire, "fire-investigation should be discovered");
  assert.deepEqual(
    fire.loadedByScenarios.map((scenario) => scenario.id),
    ["emergency", "border"],
  );

  const csv = items.find((item) => item.name === "csv-profile");
  assert.ok(csv, "csv-profile should be discovered");
  assert.deepEqual(csv.loadedByScenarios, []);
```

Replace the old assertion that every `loadedByScenarios.length === 0` with these targeted assertions.

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/test-skills-catalog.ts
```

Expected: FAIL because `loadedByScenarios` is still empty.

- [ ] **Step 3: Update catalog types**

Modify `src/types/skillCatalog.ts`:

```typescript
import type { ScenarioId } from "@datasourceintelligence/shared";

export type SkillCategory =
  | "situation"
  | "disaster"
  | "border"
  | "data"
  | "demo"
  | "developer"
  | "other";

export interface SkillCatalogScenarioUsage {
  id: ScenarioId;
  name: string;
}

export interface SkillCatalogItem {
  id: string;
  name: string;
  title: string;
  description: string;
  category: SkillCategory;
  categoryLabel: string;
  categorySource: "frontmatter" | "inferred";
  argumentHint?: string;
  allowedTools: string[];
  relativePath: string;
  sourceDir: string;
  status: "available";
  loadedByScenarios: SkillCatalogScenarioUsage[];
}
```

Keep `SkillCatalogResponse` unchanged.

- [ ] **Step 4: Populate scenario usage in scanner**

Modify `src/lib/skillCatalog.server.ts`:

```typescript
import { getSkillScenarioUsage } from "@datasourceintelligence/shared";
```

Inside `buildCatalogItem`, replace:

```typescript
loadedByScenarios: [],
```

with:

```typescript
loadedByScenarios: getSkillScenarioUsage(name),
```

- [ ] **Step 5: Add scenario badges to `SkillCard`**

In `src/components/skills/SkillCard.tsx`, render below the status row:

```tsx
{item.loadedByScenarios.length > 0 ? (
  <div className="mt-3 flex flex-wrap gap-1.5">
    {item.loadedByScenarios.map((scenario) => (
      <span
        key={scenario.id}
        className="rounded border border-[#00E0FF]/30 bg-[#00E0FF]/10 px-2 py-0.5 text-[11px] text-[#00E0FF]"
      >
        {scenario.name}
      </span>
    ))}
  </div>
) : (
  <div className="mt-3 text-[11px] text-[#8888AA]">暂未被场景加载</div>
)}
```

- [ ] **Step 6: Add scenario usage to `SkillDetailDrawer`**

In `src/components/skills/SkillDetailDrawer.tsx`, add a section after source:

```tsx
<section>
  <h3 className="mb-2 text-sm font-medium text-[#EAEAEA]">加载场景</h3>
  {item.loadedByScenarios.length > 0 ? (
    <div className="flex flex-wrap gap-2">
      {item.loadedByScenarios.map((scenario) => (
        <span
          key={scenario.id}
          className="rounded border border-[#00E0FF]/30 bg-[#00E0FF]/10 px-2.5 py-1 text-xs text-[#00E0FF]"
        >
          {scenario.name}
        </span>
      ))}
    </div>
  ) : (
    <p className="text-sm text-[#8888AA]">暂未被任何场景加载</p>
  )}
</section>
```

- [ ] **Step 7: Update component smoke item**

Modify the test item in `api/scripts/test-skill-components.tsx`:

```typescript
loadedByScenarios: [{ id: "border", name: "边防" }],
```

- [ ] **Step 8: Run smoke tests**

Run:

```powershell
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/test-skills-catalog.ts
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/test-skill-components.tsx
```

Expected:
- `PASS skill catalog parser: 12 skills`
- `PASS skill component smoke test`

- [ ] **Step 9: Commit**

```bash
git add src/types/skillCatalog.ts src/lib/skillCatalog.server.ts src/components/skills/SkillCard.tsx src/components/skills/SkillDetailDrawer.tsx api/scripts/test-skills-catalog.ts api/scripts/test-skill-components.tsx
git commit -m "feat(skills): show scenario usage"
```

---

### Task 3: ChatPanel Scenario Switcher And System Separator

**Files:**
- Create: `src/components/chat/ScenarioSwitcher.tsx`
- Modify: `src/types/prd.ts`
- Modify: `src/components/ChatPanel.tsx`
- Modify: `src/components/chat/ChatHeader.tsx`
- Modify: `src/components/chat/ChatMessageList.tsx`
- Modify: `src/components/chat/ChatInput.tsx`
- Modify: `src/hooks/useTaskChat.ts`
- Test: `api/scripts/test-scenario-chat.tsx`

**Interfaces:**
- Consumes:
  - `ScenarioProfile`, `ScenarioId`, `SCENARIOS` from Task 1.
- Produces:
  - `ChatPanel` props:
    - `scenario: ScenarioProfile`
    - `onScenarioChange: (scenarioId: ScenarioId) => void`
  - `useTaskChat` return adds `addSystemMessage(content: string): void`.
  - `ChatMessage.role` includes `"system"`.

- [ ] **Step 1: Write the failing chat smoke test**

Create `api/scripts/test-scenario-chat.tsx`:

```typescript
import { strict as assert } from "node:assert";
import { isValidElement } from "react";
import { getScenarioProfile } from "@datasourceintelligence/shared";

function unwrapDefault(moduleValue: unknown) {
  return (moduleValue as { default?: unknown }).default ?? moduleValue;
}

const ScenarioSwitcher = unwrapDefault(await import("../../src/components/chat/ScenarioSwitcher.tsx"));
const ChatHeader = unwrapDefault(await import("../../src/components/chat/ChatHeader.tsx"));
const ChatInput = unwrapDefault(await import("../../src/components/chat/ChatInput.tsx"));
const ChatPanel = unwrapDefault(await import("../../src/components/ChatPanel.tsx"));

const scenario = getScenarioProfile("marine");

const switcher = ScenarioSwitcher({
  scenario,
  onScenarioChange: () => undefined,
});
const header = ChatHeader({
  title: scenario.chatTitle,
  subtitle: scenario.chatSubtitle,
  onHistoryToggle: () => undefined,
});
const input = ChatInput({
  inputValue: "",
  isLoading: false,
  inputRef: { current: null },
  placeholder: scenario.inputPlaceholder,
  onChange: () => undefined,
  onSend: () => undefined,
});
const panel = ChatPanel({
  scenario,
  onScenarioChange: () => undefined,
  onSendMessage: () => undefined,
});

assert.ok(isValidElement(switcher), "ScenarioSwitcher should render a React element");
assert.ok(isValidElement(header), "ChatHeader should render with scenario copy");
assert.ok(isValidElement(input), "ChatInput should render with scenario placeholder");
assert.ok(isValidElement(panel), "ChatPanel should accept scenario props");

console.log("PASS scenario chat smoke test");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/test-scenario-chat.tsx
```

Expected: FAIL because `ScenarioSwitcher.tsx` does not exist and ChatPanel lacks scenario props.

- [ ] **Step 3: Extend chat message role**

Modify `src/types/prd.ts`:

```typescript
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  hasGisData?: boolean;
  gisData?: GisData;
  taskId?: string;
  thinking?: string;
  thinkingSteps?: ThinkingStep[];
  isThinkingExpanded?: boolean;
  agentLoopLogFilePath?: string;
}
```

- [ ] **Step 4: Add system message helper to `useTaskChat`**

Modify `UseTaskChatReturn` in `src/hooks/useTaskChat.ts`:

```typescript
addSystemMessage: (content: string) => void;
```

Add this function before `deleteMessage`:

```typescript
const addSystemMessage = (content: string) => {
  const trimmed = content.trim();
  if (!trimmed) return;
  setMessages((prev) => [
    ...prev,
    {
      id: `system-${Date.now()}`,
      role: 'system',
      content: trimmed,
      timestamp: Date.now(),
    },
  ]);
};
```

Return it:

```typescript
return {
  messages,
  inputValue,
  isLoading,
  setInputValue,
  sendMessage,
  addSystemMessage,
  deleteMessage,
  clearAll,
  toggleThinkingExpanded,
};
```

- [ ] **Step 5: Create scenario switcher**

Create `src/components/chat/ScenarioSwitcher.tsx`:

```tsx
'use client';

import { SCENARIOS, type ScenarioId, type ScenarioProfile } from '@datasourceintelligence/shared';

interface ScenarioSwitcherProps {
  scenario: ScenarioProfile;
  onScenarioChange: (scenarioId: ScenarioId) => void;
}

export default function ScenarioSwitcher({ scenario, onScenarioChange }: ScenarioSwitcherProps) {
  return (
    <div className="border-t border-[#3A3A4E] px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs text-[#8888AA]">当前场景</span>
        <select
          value={scenario.id}
          onChange={(event) => onScenarioChange(event.target.value as ScenarioId)}
          className="min-w-0 flex-1 rounded-md border border-[#3A3A4E] bg-[#2A2A3E] px-3 py-2 text-sm text-[#EAEAEA] outline-none transition-colors focus:border-[#00E0FF]"
          aria-label="切换场景"
        >
          {SCENARIOS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[#8888AA]">
        {scenario.description}
      </p>
    </div>
  );
}
```

- [ ] **Step 6: Make header copy configurable**

Modify `src/components/chat/ChatHeader.tsx`:

```tsx
'use client';

import { Clock } from 'lucide-react';

interface ChatHeaderProps {
  title: string;
  subtitle: string;
  onHistoryToggle: () => void;
}

export default function ChatHeader({ title, subtitle, onHistoryToggle }: ChatHeaderProps) {
  return (
    <div className="px-4 py-3 border-b border-[#3A3A4E] flex items-center justify-between">
      <div className="flex min-w-0 items-center gap-2">
        <div className="w-8 h-8 shrink-0 rounded-full bg-[#00E0FF]/20 flex items-center justify-center">
          <span className="text-[#00E0FF] text-sm font-medium">AI</span>
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[#EAEAEA]">{title}</div>
          <div className="truncate text-xs text-[#8888AA]">{subtitle}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onHistoryToggle}
          className="p-2 rounded-lg hover:bg-[#2A2A3E] transition-colors text-[#8888AA] hover:text-[#EAEAEA]"
          title="历史对话"
        >
          <Clock className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Make message list copy and quick actions configurable**

Modify `src/components/chat/ChatMessageList.tsx` so `SUGGESTIONS` is removed and props include:

```typescript
import type { ScenarioQuickAction } from '@datasourceintelligence/shared';

interface ChatMessageListProps {
  messages: ChatMessageType[];
  isLoading: boolean;
  greetingTitle: string;
  greetingDescription: string;
  quickActions: ScenarioQuickAction[];
  onToggleThinking: (msgId: string) => void;
  formatTime: (timestamp: number) => string;
  onSuggestion: (text: string) => void;
}
```

Replace `SuggestionButtons` props with:

```tsx
function SuggestionButtons({
  quickActions,
  onSuggestion,
}: {
  quickActions: ScenarioQuickAction[];
  onSuggestion: (text: string) => void;
}) {
  const [selected, setSelected] = useState<ScenarioQuickAction | null>(null);
```

Render quick actions with:

```tsx
{quickActions.map(({ label, prompt }) => (
  <button
    key={`${label}:${prompt}`}
    onClick={() => setSelected({ label, prompt })}
    className="px-3 py-1.5 text-xs rounded-full bg-[#2A2A3E] text-[#00E0FF] hover:bg-[#00E0FF]/20 transition-colors"
  >
    {label}
  </button>
))}
```

Inside the empty state, replace hard-coded copy with:

```tsx
<div className="text-[#EAEAEA] font-medium mb-2">{greetingTitle}</div>
<div className="text-sm text-[#8888AA] max-w-xs mx-auto">
  {greetingDescription}
</div>
<div className="mt-6">
  <SuggestionButtons quickActions={quickActions} onSuggestion={onSuggestion} />
</div>
```

Render system messages in `messages.map`:

```tsx
{messages.map((msg) =>
  msg.role === 'system' ? (
    <div key={msg.id} className="flex justify-center">
      <div className="rounded-full border border-[#3A3A4E] bg-[#1E1E2E]/80 px-3 py-1 text-xs text-[#8888AA]">
        {msg.content}
      </div>
    </div>
  ) : (
    <ChatMessage
      key={msg.id}
      msg={msg}
      onToggleThinking={onToggleThinking}
      formatTime={formatTime}
    />
  )
)}
```

For suggestions after assistant messages, render:

```tsx
{showSuggestionsAfterMsg && (
  <SuggestionButtons quickActions={quickActions} onSuggestion={onSuggestion} />
)}
```

- [ ] **Step 8: Make input placeholder configurable**

Modify `src/components/chat/ChatInput.tsx` props:

```typescript
placeholder: string;
```

Use it in the input:

```tsx
placeholder={placeholder}
```

- [ ] **Step 9: Wire scenario props in ChatPanel**

Modify `src/components/ChatPanel.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { ScenarioId, ScenarioProfile } from '@datasourceintelligence/shared';
import { ChatMessage as ChatMessageType, ThinkingStep, GisData, Task } from '@/types/prd';
import { useTaskChat } from '@/hooks/useTaskChat';
import ChatHeader from './chat/ChatHeader';
import ChatHistory from './chat/ChatHistory';
import ChatMessageList from './chat/ChatMessageList';
import ChatInput from './chat/ChatInput';
import ScenarioSwitcher from './chat/ScenarioSwitcher';

interface ChatPanelProps {
  scenario: ScenarioProfile;
  onScenarioChange: (scenarioId: ScenarioId) => void;
  onSendMessage: (message: string) => void;
  onGisDataRequest?: (gisData: GisData) => void;
  onTaskCreate?: (task: Task, steps: ThinkingStep[], gisData?: GisData) => void;
  onTaskFinished?: (taskId: string, status: 'completed' | 'failed') => void;
  onGisOperation?: (operations: Array<Record<string, unknown>>) => void;
}
```

Destructure `addSystemMessage` from `useTaskChat`.

Add:

```typescript
const previousScenarioIdRef = useRef<ScenarioId>(scenario.id);

useEffect(() => {
  if (previousScenarioIdRef.current === scenario.id) return;
  previousScenarioIdRef.current = scenario.id;
  addSystemMessage(scenario.switchMessage);
}, [scenario.id, scenario.switchMessage, addSystemMessage]);
```

Pass scenario copy to children:

```tsx
<ChatHeader
  title={scenario.chatTitle}
  subtitle={scenario.chatSubtitle}
  onHistoryToggle={() => setIsHistoryOpen(!isHistoryOpen)}
/>
```

```tsx
<ChatMessageList
  messages={messages}
  isLoading={isLoading}
  greetingTitle={scenario.greetingTitle}
  greetingDescription={scenario.greetingDescription}
  quickActions={scenario.quickActions}
  onToggleThinking={toggleThinkingExpanded}
  formatTime={formatTime}
  onSuggestion={(text) => {
    setInputValue(text);
    inputRef.current?.focus();
  }}
/>
```

Place the switcher directly above `ChatInput`:

```tsx
<ScenarioSwitcher scenario={scenario} onScenarioChange={onScenarioChange} />
<ChatInput
  inputValue={inputValue}
  isLoading={isLoading}
  inputRef={inputRef}
  placeholder={scenario.inputPlaceholder}
  onChange={setInputValue}
  onSend={handleSendClick}
/>
```

- [ ] **Step 10: Run chat smoke**

Run:

```powershell
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/test-scenario-chat.tsx
```

Expected: PASS and prints `PASS scenario chat smoke test`.

- [ ] **Step 11: Commit**

```bash
git add src/types/prd.ts src/hooks/useTaskChat.ts src/components/ChatPanel.tsx src/components/chat/ChatHeader.tsx src/components/chat/ChatMessageList.tsx src/components/chat/ChatInput.tsx src/components/chat/ScenarioSwitcher.tsx api/scripts/test-scenario-chat.tsx
git commit -m "feat(chat): add scenario switcher"
```

---

### Task 4: Scenario-Driven Map Baseline Layers

**Files:**
- Modify: `src/app/page.tsx`
- Test: `api/scripts/test-scenario-map-and-api.ts`

**Interfaces:**
- Consumes:
  - `getScenarioProfile(activeScenarioId)`
  - `ScenarioProfile.mapLayers`
- Produces:
  - Home page state `activeScenarioId`
  - Derived `visibleEntities`
  - Derived `visibleTrajectories`
  - Scenario changes clear selected entity, selected task, active GIS ids, active GIS data list, and pending operations.

- [ ] **Step 1: Write failing map helper assertions**

Create `api/scripts/test-scenario-map-and-api.ts` with the map-only assertions first:

```typescript
import { strict as assert } from "node:assert";
import { getScenarioProfile } from "@datasourceintelligence/shared";

function visibleEntityTypesForScenario(scenarioId: string) {
  const scenario = getScenarioProfile(scenarioId);
  return {
    showShips: scenario.mapLayers.includes("ais"),
    showAircraft: scenario.mapLayers.includes("ads"),
  };
}

assert.deepEqual(visibleEntityTypesForScenario("osint"), {
  showShips: true,
  showAircraft: true,
});
assert.deepEqual(visibleEntityTypesForScenario("marine"), {
  showShips: false,
  showAircraft: false,
});
assert.deepEqual(visibleEntityTypesForScenario("emergency"), {
  showShips: false,
  showAircraft: false,
});
assert.deepEqual(visibleEntityTypesForScenario("border"), {
  showShips: false,
  showAircraft: false,
});

console.log("PASS scenario map and api smoke test");
```

- [ ] **Step 2: Run map helper smoke**

Run:

```powershell
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/test-scenario-map-and-api.ts
```

Expected: PASS once Task 1 exists. This protects the profile values before wiring the UI.

- [ ] **Step 3: Add active scenario state to HomePage**

Modify imports in `src/app/page.tsx`:

```typescript
import {
  DEFAULT_SCENARIO_ID,
  getScenarioProfile,
  type ScenarioId,
} from '@datasourceintelligence/shared';
```

Add state near other UI state:

```typescript
const [activeScenarioId, setActiveScenarioId] = useState<ScenarioId>(DEFAULT_SCENARIO_ID);
const activeScenario = useMemo(() => getScenarioProfile(activeScenarioId), [activeScenarioId]);
```

- [ ] **Step 4: Add scenario change handler**

Add this callback in `src/app/page.tsx`:

```typescript
const handleScenarioChange = useCallback((scenarioId: ScenarioId) => {
  setActiveScenarioId(scenarioId);
  setSelectedEntity(null);
  setSelectedTask(null);
  setActiveGisIds(new Set());
  setActiveGisDataList([]);
  setPendingOperations([]);
}, []);
```

- [ ] **Step 5: Filter baseline map data**

Replace `allEntities` and `allTrajectories` with:

```typescript
const visibleEntities = useMemo(() => {
  const items: Entity[] = [];
  if (activeScenario.mapLayers.includes('ais')) items.push(...aisEntities);
  if (activeScenario.mapLayers.includes('ads')) items.push(...adsEntities);
  return items;
}, [activeScenario.mapLayers, aisEntities, adsEntities]);

const visibleTrajectories = useMemo(() => {
  const items: Trajectory[] = [];
  if (activeScenario.mapLayers.includes('ais')) items.push(...aisTrajectories);
  if (activeScenario.mapLayers.includes('ads')) items.push(...adsTrajectories);
  return items;
}, [activeScenario.mapLayers, aisTrajectories, adsTrajectories]);
```

If lint warns about array identity for `activeScenario.mapLayers`, use `activeScenarioId` as the scenario dependency:

```typescript
}, [activeScenarioId, aisEntities, adsEntities]);
```

- [ ] **Step 6: Pass scenario into ChatPanel**

Modify the `ChatPanel` usage in `src/app/page.tsx`:

```tsx
<ChatPanel
  scenario={activeScenario}
  onScenarioChange={handleScenarioChange}
  onSendMessage={handleSendMessage}
  onGisDataRequest={(gisData) => {
    const eventId = `auto-gis-${gisDataCounterRef.current++}`;
    pushActiveGisData(gisData, eventId);
  }}
  onTaskCreate={handleTaskCreate}
  onTaskFinished={handleTaskFinished}
  onGisOperation={handleGisOperation}
/>
```

- [ ] **Step 7: Pass filtered map data into GisViewer**

Modify the `GisViewer` usage:

```tsx
<GisViewer
  cesiumMapRef={cesiumMapRef}
  mapCanvasOverlay={mapCanvasOverlay}
  entities={visibleEntities}
  trajectories={visibleTrajectories}
  regions={EMPTY_REGIONS}
```

- [ ] **Step 8: Run smoke and targeted lint**

Run:

```powershell
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/test-scenario-map-and-api.ts
& 'S:\Projects\projects_new\node_modules\.bin\eslint.cmd' src/app/page.tsx src/components/ChatPanel.tsx src/components/chat/ScenarioSwitcher.tsx
```

Expected:
- `PASS scenario map and api smoke test`
- ESLint has no new errors.

- [ ] **Step 9: Commit**

```bash
git add src/app/page.tsx api/scripts/test-scenario-map-and-api.ts
git commit -m "feat(map): filter baseline layers by scenario"
```

---

### Task 5: Scenario Id In Frontend Task Creation

**Files:**
- Modify: `src/lib/api.ts`
- Modify: `src/hooks/useTaskChat.ts`
- Modify: `src/components/ChatPanel.tsx`
- Modify: `api/scripts/test-scenario-map-and-api.ts`

**Interfaces:**
- Consumes:
  - `ScenarioId` from shared profiles.
- Produces:
  - `createAgentTask(query: string, options?: { scenarioId?: ScenarioId })`
  - `useTaskChat({ scenarioId })`
  - `/tasks` request body contains `scenarioId`.

- [ ] **Step 1: Extend API smoke test for request body**

Append to `api/scripts/test-scenario-map-and-api.ts`:

```typescript
import { readFile } from "node:fs/promises";

const apiSource = await readFile("src/lib/api.ts", "utf8");
const hookSource = await readFile("src/hooks/useTaskChat.ts", "utf8");

assert.ok(
  apiSource.includes("scenarioId?: ScenarioId"),
  "createAgentTask should accept an optional scenario id",
);
assert.ok(
  apiSource.includes("JSON.stringify({ query, userId: AGENT_LOOP_FIXED_USER_ID, scenarioId: options?.scenarioId })"),
  "createAgentTask should send scenarioId in the request body",
);
assert.ok(
  hookSource.includes("createAgentTask(userMessage.content, { scenarioId })"),
  "useTaskChat should pass the active scenario id",
);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/test-scenario-map-and-api.ts
```

Expected: FAIL because `createAgentTask` does not accept `scenarioId` yet.

- [ ] **Step 3: Update API client**

Modify `src/lib/api.ts`:

```typescript
import type { ScenarioId } from "@datasourceintelligence/shared";
```

Replace `createAgentTask` with:

```typescript
export async function createAgentTask(
  query: string,
  options: { scenarioId?: ScenarioId } = {},
): Promise<{
  taskId: string;
  status: string;
}> {
  return fetchJson("/tasks", {
    method: "POST",
    body: JSON.stringify({ query, userId: AGENT_LOOP_FIXED_USER_ID, scenarioId: options.scenarioId }),
  });
}
```

- [ ] **Step 4: Pass scenario id through useTaskChat**

Modify imports in `src/hooks/useTaskChat.ts`:

```typescript
import type { ScenarioId } from "@datasourceintelligence/shared";
```

Add to `UseTaskChatOptions`:

```typescript
scenarioId?: ScenarioId;
```

Change the hook signature:

```typescript
export function useTaskChat({
  scenarioId,
  onGisDataRequest,
  onGisOperation,
  onTaskCreate,
  onTaskFinished,
}: UseTaskChatOptions = {}): UseTaskChatReturn {
```

Replace:

```typescript
const result = await createAgentTask(userMessage.content);
```

with:

```typescript
const result = await createAgentTask(userMessage.content, { scenarioId });
```

- [ ] **Step 5: Pass scenario id from ChatPanel to hook**

Modify the hook call in `src/components/ChatPanel.tsx`:

```typescript
} = useTaskChat({
  scenarioId: scenario.id,
  onGisDataRequest,
  onGisOperation,
  onTaskCreate,
  onTaskFinished,
});
```

- [ ] **Step 6: Run tests**

Run:

```powershell
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/test-scenario-map-and-api.ts
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/test-scenario-chat.tsx
```

Expected:
- `PASS scenario map and api smoke test`
- `PASS scenario chat smoke test`

- [ ] **Step 7: Commit**

```bash
git add src/lib/api.ts src/hooks/useTaskChat.ts src/components/ChatPanel.tsx api/scripts/test-scenario-map-and-api.ts
git commit -m "feat(tasks): send scenario id from chat"
```

---

### Task 6: Backend Scenario Context Plumbing

**Files:**
- Modify: `api/src/modules/agent-loop/tools/_shared/types.ts`
- Modify: `api/src/modules/agent-loop/runAgentLoop.ts`
- Modify: `api/src/modules/tasks/pipeline.ts`
- Test: `api/scripts/agent-loop/agent-loop-scenario-skill-filter-test.ts`

**Interfaces:**
- Consumes:
  - `CreateTaskRequest.scenarioId`
  - `ScenarioId` from shared profiles.
- Produces:
  - `RunAgentLoopOptions.scenarioId?: ScenarioId`
  - `AgentLoopToolUseContext.scenarioId?: ScenarioId`

- [ ] **Step 1: Write backend plumbing source test**

Create `api/scripts/agent-loop/agent-loop-scenario-skill-filter-test.ts`:

```typescript
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";

const runAgentLoopSource = await readFile("api/src/modules/agent-loop/runAgentLoop.ts", "utf8");
const sharedTypesSource = await readFile("api/src/modules/agent-loop/tools/_shared/types.ts", "utf8");
const pipelineSource = await readFile("api/src/modules/tasks/pipeline.ts", "utf8");

assert.ok(
  sharedTypesSource.includes("scenarioId?: ScenarioId"),
  "AgentLoopToolUseContext should carry scenarioId",
);
assert.ok(
  runAgentLoopSource.includes("scenarioId?: ScenarioId"),
  "RunAgentLoopOptions should accept scenarioId",
);
assert.ok(
  runAgentLoopSource.includes("scenarioId: options.scenarioId"),
  "runAgentLoop should pass scenarioId into tool-use context",
);
assert.ok(
  pipelineSource.includes("scenarioId: body.scenarioId"),
  "task pipeline should pass request scenarioId into Agent Loop",
);

console.log("PASS agent-loop scenario skill filter source checks");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/agent-loop/agent-loop-scenario-skill-filter-test.ts
```

Expected: FAIL because backend context does not carry `scenarioId`.

- [ ] **Step 3: Add scenario id to tool-use context type**

Modify imports in `api/src/modules/agent-loop/tools/_shared/types.ts`:

```typescript
import type {
  AgentLoopEvent,
  AgentLoopResult,
  CameraView,
  Entity,
  GisData,
  Region,
  ScenarioId,
  Trajectory,
} from "@datasourceintelligence/shared";
```

Add to `AgentLoopToolUseContext`:

```typescript
scenarioId?: ScenarioId;
```

- [ ] **Step 4: Add scenario id to run options**

Modify imports in `api/src/modules/agent-loop/runAgentLoop.ts`:

```typescript
import type { ScenarioId } from "@datasourceintelligence/shared";
```

Add to `RunAgentLoopOptions`:

```typescript
scenarioId?: ScenarioId;
```

Add to `createAgentLoopToolUseContext` input:

```typescript
scenarioId?: ScenarioId;
```

Set it in the returned context:

```typescript
scenarioId: input.scenarioId,
```

Pass it at the creation site:

```typescript
let toolUseContext = createAgentLoopToolUseContext({
  taskId: options.taskId,
  query: options.query,
  scenarioId: options.scenarioId,
  messages: initialMessages,
  observations,
  tools: registry.list(),
  skillManager,
  signal: options.signal,
});
```

When `updateAgentLoopToolUseContext` returns `{ ...context, ... }`, the scenario id is preserved automatically.

- [ ] **Step 5: Pass request scenario id from pipeline**

Modify `api/src/modules/tasks/pipeline.ts`:

```typescript
const loopResult = await runAgentLoop({
  taskId,
  query: body.query,
  scenarioId: body.scenarioId,
  fileLogger,
  turnDelayMs: isDemoQuery(body.query) ? DEMO_TURN_DELAY_MS : undefined,
  maxTurns: isDemoQuery(body.query) ? DEMO_MAX_TURNS : undefined,
  transcriptStore: createBestEffortTranscriptStore(transcriptStore, console),
  memoryManager: createPipelineMemoryManager({
    currentTaskId: taskId,
    currentTask,
    env: process.env,
    transcriptStore,
    listRecentCompletedTasks: createDbRecentTaskLister(db),
    logger: console,
  }),
});
```

- [ ] **Step 6: Run source test**

Run:

```powershell
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/agent-loop/agent-loop-scenario-skill-filter-test.ts
```

Expected: PASS and prints `PASS agent-loop scenario skill filter source checks`.

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/agent-loop/tools/_shared/types.ts api/src/modules/agent-loop/runAgentLoop.ts api/src/modules/tasks/pipeline.ts api/scripts/agent-loop/agent-loop-scenario-skill-filter-test.ts
git commit -m "feat(agent-loop): carry scenario context"
```

---

### Task 7: Backend Skill Listing And Invocation Filter

**Files:**
- Modify: `api/src/modules/agent-loop/skillManager.ts`
- Modify: `api/scripts/agent-loop/agent-loop-scenario-skill-filter-test.ts`

**Interfaces:**
- Consumes:
  - `toolUseContext.scenarioId`
  - `getScenarioProfile(scenarioId).skillIds`
- Produces:
  - Skill listing contains only active scenario skills.
  - `Skill(...)` rejects skills not enabled in active scenario.
  - No filtering happens when `scenarioId` is missing.

- [ ] **Step 1: Extend backend source test for filter functions**

Append to `api/scripts/agent-loop/agent-loop-scenario-skill-filter-test.ts`:

```typescript
const skillManagerSource = await readFile("api/src/modules/agent-loop/skillManager.ts", "utf8");

assert.ok(
  skillManagerSource.includes("getScenarioProfile"),
  "SkillManager should read shared scenario profiles",
);
assert.ok(
  skillManagerSource.includes("filterSkillsForScenario"),
  "SkillManager should filter skill listings by scenario",
);
assert.ok(
  skillManagerSource.includes("assertSkillEnabledForScenario"),
  "Skill tool validation should reject disallowed scenario skills",
);
assert.ok(
  skillManagerSource.includes("Skill ${skill.name} is not enabled for scenario"),
  "Skill rejection should explain the active scenario boundary",
);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/agent-loop/agent-loop-scenario-skill-filter-test.ts
```

Expected: FAIL because `skillManager.ts` has no scenario filter.

- [ ] **Step 3: Import shared scenario helpers**

Modify `api/src/modules/agent-loop/skillManager.ts` imports:

```typescript
import { getScenarioProfile } from "@datasourceintelligence/shared";
```

- [ ] **Step 4: Filter listing sections**

Replace:

```typescript
const skills = this.listModelInvocableSkills();
```

inside `getSkillListingSections` with:

```typescript
const skills = filterSkillsForScenario(
  this.listModelInvocableSkills(),
  toolUseContext.scenarioId,
);
```

Inside `collectDiscoverySections`, replace the `skills` constant with:

```typescript
const skills = filterSkillsForScenario(
  names
    .map((name) => this.skills.get(name))
    .filter((skill): skill is SkillDefinition => Boolean(skill))
    .filter(isModelInvocableSkill),
  toolUseContext.scenarioId,
);
```

- [ ] **Step 5: Validate Skill tool calls**

In `buildSkillTool.validateInput`, after the existing `userInvocable` check, add:

```typescript
assertSkillEnabledForScenario(skill, requireToolUseContext(context));
```

In `buildSkillTool.execute`, after the second `if (!skill)` block and before `validateSkillArguments`, add:

```typescript
assertSkillEnabledForScenario(skill, toolUseContext);
```

- [ ] **Step 6: Add helper functions**

Add near the bottom of `skillManager.ts`, before `isModelInvocableSkill`:

```typescript
function filterSkillsForScenario(
  skills: SkillDefinition[],
  scenarioId: AgentLoopToolUseContext["scenarioId"],
): SkillDefinition[] {
  if (!scenarioId) return skills;
  const scenario = getScenarioProfile(scenarioId);
  const allowedSkillNames = new Set(scenario.skillIds.map(normalizeSkillName));
  return skills.filter((skill) => allowedSkillNames.has(normalizeSkillName(skill.name)));
}

function assertSkillEnabledForScenario(
  skill: SkillDefinition,
  toolUseContext: AgentLoopToolUseContext,
): void {
  if (!toolUseContext.scenarioId) return;
  const scenario = getScenarioProfile(toolUseContext.scenarioId);
  const allowedSkillNames = new Set(scenario.skillIds.map(normalizeSkillName));
  if (allowedSkillNames.has(normalizeSkillName(skill.name))) return;

  throw new Error(
    `Skill ${skill.name} is not enabled for scenario ${scenario.id} (${scenario.name}).`,
  );
}
```

- [ ] **Step 7: Add behavior test using a fake model**

After source checks in `api/scripts/agent-loop/agent-loop-scenario-skill-filter-test.ts`, add a lightweight model test:

```typescript
import { runAgentLoopEvents } from "../../src/modules/agent-loop/runAgentLoop.js";
import type { AgentLoopEvent, ModelClient } from "../../src/modules/agent-loop/tools/_shared/types.js";

const listingClient: ModelClient = {
  async decide({ messages }) {
    const systemText = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");

    assert.ok(systemText.includes("oil-spill-tracing"), "marine listing should include oil-spill-tracing");
    assert.ok(systemText.includes("ais-region-query"), "marine listing should include ais-region-query");
    assert.ok(!systemText.includes("daily-report"), "marine listing should not include daily-report");
    assert.ok(!systemText.includes("aircraft-region-query"), "marine listing should not include aircraft-region-query");

    return {
      type: "final_answer",
      content: "listing checked",
    };
  },
};

const listingEvents: AgentLoopEvent[] = [];
for await (const event of runAgentLoopEvents({
  taskId: "00000000-0000-4000-8000-000000000101",
  query: "检查海洋场景 skill listing",
  scenarioId: "marine",
  modelClient: listingClient,
  maxTurns: 1,
  fileLogger: false,
})) {
  listingEvents.push(event);
}

assert.ok(listingEvents.some((event) => event.type === "loop_stop"));

const rejectedClient: ModelClient = {
  async decide() {
    return {
      type: "tool_calls",
      toolCalls: [
        {
          id: "call-disallowed-skill",
          name: "Skill",
          input: { skill: "daily-report", args: "今天" },
        },
      ],
    };
  },
};

const rejectionEvents: AgentLoopEvent[] = [];
for await (const event of runAgentLoopEvents({
  taskId: "00000000-0000-4000-8000-000000000102",
  query: "海洋场景不应允许日报 skill",
  scenarioId: "marine",
  modelClient: rejectedClient,
  maxTurns: 1,
  fileLogger: false,
})) {
  rejectionEvents.push(event);
}

const rejectionText = JSON.stringify(rejectionEvents);
assert.ok(
  rejectionText.includes("Skill daily-report is not enabled for scenario marine"),
  "disallowed skill invocation should be rejected",
);
```

- [ ] **Step 8: Run backend skill filter test**

Run:

```powershell
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/agent-loop/agent-loop-scenario-skill-filter-test.ts
```

Expected: PASS and prints `PASS agent-loop scenario skill filter source checks`.

- [ ] **Step 9: Commit**

```bash
git add api/src/modules/agent-loop/skillManager.ts api/scripts/agent-loop/agent-loop-scenario-skill-filter-test.ts
git commit -m "feat(agent-loop): filter skills by scenario"
```

---

### Task 8: End-To-End Verification

**Files:**
- No planned source edits unless verification finds a small issue.

**Interfaces:**
- Consumes:
  - Tasks 1-7 complete.
- Produces:
  - Verified local scenario switcher, Skill Gallery usage, `/api/skills`, and backend Skill filter behavior.

- [ ] **Step 1: Run shared and feature smoke tests**

Run:

```powershell
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/test-scenarios-shared.ts
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/test-skills-catalog.ts
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/test-skill-components.tsx
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/test-skill-page.tsx
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/test-skill-navigation.ts
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/test-scenario-chat.tsx
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/test-scenario-map-and-api.ts
& 'S:\Projects\projects_new\node_modules\.bin\tsx.cmd' api/scripts/agent-loop/agent-loop-scenario-skill-filter-test.ts
```

Expected: every script prints `PASS ...`.

- [ ] **Step 2: Run targeted lint**

Run:

```powershell
& 'S:\Projects\projects_new\node_modules\.bin\eslint.cmd' packages/shared/src/scenarios.ts packages/shared/src/types/task.ts src/types/skillCatalog.ts src/lib/skillCatalog.server.ts src/components/skills/SkillCard.tsx src/components/skills/SkillDetailDrawer.tsx src/types/prd.ts src/hooks/useTaskChat.ts src/components/ChatPanel.tsx src/components/chat/ChatHeader.tsx src/components/chat/ChatMessageList.tsx src/components/chat/ChatInput.tsx src/components/chat/ScenarioSwitcher.tsx src/app/page.tsx src/lib/api.ts api/src/modules/agent-loop/tools/_shared/types.ts api/src/modules/agent-loop/runAgentLoop.ts api/src/modules/tasks/pipeline.ts api/src/modules/agent-loop/skillManager.ts
```

Expected: no new errors. Existing `<img>` warnings in `UserCenter.tsx` are unrelated and should not appear in this targeted command.

- [ ] **Step 3: Run focused TypeScript checks**

Run:

```powershell
& 'S:\Projects\projects_new\node_modules\.bin\tsc.cmd' -p packages/shared/tsconfig.json
& 'S:\Projects\projects_new\node_modules\.bin\tsc.cmd' -p api/tsconfig.json
```

Expected:
- Shared build passes.
- API type check passes or reports only pre-existing issues unrelated to changed files. If API type check reports scenario-related errors, fix those before continuing.

- [ ] **Step 4: Verify `/api/skills`**

Use the local app server on port `5000` if already running. Otherwise start it with:

```powershell
& 'S:\Projects\projects_new\node_modules\.bin\next.cmd' dev --webpack --port 5000
```

Then run:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5000/api/skills
```

Expected:
- Response status is `200`.
- `oil-spill-tracing.loadedByScenarios` contains `marine`.
- `fire-investigation.loadedByScenarios` contains both `emergency` and `border`.

- [ ] **Step 5: Browser verify ChatPanel scenario switcher**

Open `http://127.0.0.1:5000/`, log in with:

```text
username: admin
password: admin123
```

Expected:
- ChatPanel starts in `开源情报分析`.
- The map displays AIS ships and ADS-B aircraft.
- Switch to `海洋`.
- Chat history remains.
- A centered system separator appears with `已切换到「海洋」场景`.
- Quick actions change to oil-spill and maritime actions.
- Baseline aircraft and ship layers disappear.
- Switch to `应急`.
- Quick actions change to fire and earthquake demo actions.

- [ ] **Step 6: Browser verify Skill Gallery usage**

Open `http://127.0.0.1:5000/skills`.

Expected:
- `Oil Spill Tracing` card shows `海洋`.
- `Fire Investigation` card shows `应急` and `边防`.
- `Csv Profile` card shows `暂未被场景加载`.
- Opening a skill detail drawer shows the same usage under `加载场景`.

- [ ] **Step 7: Final commit if verification required small fixes**

Only run this if Task 8 caused source changes:

```bash
git add <changed-files>
git commit -m "fix(scenarios): polish scenario verification"
```

---

## Self-Review

- Spec coverage: shared scenario source, ChatPanel switcher, preserved chat history, system separator, map baseline filtering, frontend task request, backend task schema, Agent Loop context, Skill listing filtering, Skill call rejection, and Skill Gallery scenario usage are all covered.
- Placeholder scan: the plan contains no unfinished requirement markers and no unspecified file paths.
- Type consistency: `ScenarioId`, `ScenarioProfile`, `ScenarioQuickAction`, `ScenarioMapLayerId`, `SkillCatalogScenarioUsage`, `scenarioId`, and `loadedByScenarios` are defined before use and reused consistently.
- Scope check: lower-level tool permission filtering is intentionally out of scope for this phase.

## Execution Notes

- Implement one task at a time and commit after each task.
- Keep the unrelated `.gitignore` working-tree change untouched unless the user explicitly asks to include it.
- Use direct local binaries such as `node_modules\.bin\tsx.cmd`, `node_modules\.bin\tsc.cmd`, and `node_modules\.bin\eslint.cmd` if `pnpm` hits the known no-TTY module purge issue on this machine.
