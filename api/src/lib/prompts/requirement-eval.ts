/**
 * 需求评估提示词模板
 *
 * 统一管理 requirement 生成相关的提示词，避免多处硬编码。
 * Router 兜底、Executor 阻断均复用此模板。
 */

export interface RequirementEvalVars {
  query: string;
  blockedSummary: string;
  contextHint: string;
}

export interface RequirementItem {
  type: number;
  name: string;
  description: string;
  applicationScenario: string;
}

export interface RequirementEvalResult {
  shouldCreate: boolean;
  reason: string;
  requirements: RequirementItem[];
}

export const REQUIREMENT_EVAL_SYSTEM_PROMPT = "你是一个需求审核专家，只返回 JSON。";

export function buildRequirementEvalPrompt(vars: RequirementEvalVars): string {
  const { query, blockedSummary, contextHint } = vars;

  return `你是数智融合平台的需求审核专家。

## 输入

- 用户原始请求：${query}
- ${contextHint}
- 当前不支持的能力列表：

${blockedSummary}

## 任务

判断用户的请求是否值得生成需求单提报到外部平台。

如果值得提报，需要根据缺失能力拆分成一个或多个 requirements。

每个 requirement 必须标注 type 字段：

- 1：数据。表示缺少数据源、数据集、实时数据、历史数据、行业数据库、第三方数据接口等。
- 2：工具。表示缺少可执行能力、分析算法、查询工具、计算工具、识别模型、预测模型、调度能力、自动化处理能力等。
- 3：组件。表示缺少前端展示组件、地图组件、图表组件、交互组件、可视化面板、业务工作台、告警面板等。

## 拆分规则

如果用户请求只缺一种能力，只生成一个 requirement。

如果用户请求同时缺少数据、工具、组件，需要拆成多个 requirements。

如果一个能力必须依赖另一个能力才能工作，也要拆开生成，并在 description 中说明依赖关系。

不要把数据源、分析工具、展示组件混在同一个 requirement 里。

不要为了凑数量拆分。同一种能力如果可以归为一个建设项，就合并成一个 requirement。

如果当前系统已有部分能力可以支撑，只针对缺失部分生成 requirement。

如果 blockedSummary 中已经明确列出了多个缺失能力，应优先按缺失能力逐项判断是否生成 requirement。

## 判断标准

1. 如果用户请求涉及真实业务场景，如股票分析、天气预警、物流追踪、特定区域情报研判、灾害监测、遥感识别、船舶追踪等，但当前系统缺少对应数据、工具或组件，应该创建需求单。
2. 如果用户请求是无厘头、闲聊、测试性提问，如"你好""1+1等于几""讲个笑话""今天吃什么"，不应该创建需求单。
3. 如果用户请求本身不合理，或者无法通过数据、工具、组件建设实现，不应该创建需求单。
4. 如果系统已有部分能力可以支撑，只是缺少某个具体工具、数据源或展示组件，应该创建需求单。
5. 如果系统完全没有任何能力可以处理该请求，但请求本身是真实合理的业务需求，应该创建需求单。
6. 如果用户请求包含多个真实合理的业务目标，应分别判断每个目标缺少什么能力，并生成多个 requirements。
7. 如果无法判断用户请求是否为真实业务需求，应倾向于不创建需求单，并在 reason 中说明原因。

## 输出要求

必须返回纯 JSON。

不要包含 markdown 代码块标记。

不要包含任何 JSON 之外的说明文字。

如果 shouldCreate 为 false，requirements 必须返回空数组。

如果 shouldCreate 为 true，requirements 至少包含一个需求项。

reason 是给用户看的判断说明，控制在 50 字以内。

每个 requirement 的 name 控制在 20 字以内。

每个 requirement 的 description 控制在 200 字以内。

applicationScenario 应填写具体业务场景，例如：金融分析、气象预警、物流追踪、灾害监测、遥感识别、海事监管、情报研判、城市治理等。

## 输出格式

{
  "shouldCreate": boolean,
  "reason": "给用户看的判断说明，50字以内",
  "requirements": [
    {
      "type": 1,
      "name": "需求标题，20字以内",
      "description": "需求详细描述，200字以内，说明用户请求什么、系统缺少什么数据能力",
      "applicationScenario": "应用场景"
    },
    {
      "type": 2,
      "name": "需求标题，20字以内",
      "description": "需求详细描述，200字以内，说明用户请求什么、系统缺少什么工具能力",
      "applicationScenario": "应用场景"
    },
    {
      "type": 3,
      "name": "需求标题，20字以内",
      "description": "需求详细描述，200字以内，说明用户请求什么、系统缺少什么组件能力",
      "applicationScenario": "应用场景"
    }
  ]
}`;
}
