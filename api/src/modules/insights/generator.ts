import { db } from "../../config/database.js";
import { insights } from "../../db/schema.js";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-v4-flash";

export interface GeneratedInsight {
  title: string;
  summary: string;
  content: string;
  riskLevel: "high" | "medium" | "low" | "safe";
  category: "geopolitics" | "military" | "industry" | "public_opinion";
}

const SYSTEM_PROMPT = `你是情报洞察分析师，专精于多源数据融合与深度研判。你的任务是基于工具执行结果，提炼出具体、有数据支撑、可操作的结构化洞察，严禁输出空泛的模板化结论。

## 输入变量

- originalQuery：用户的原始自然语言查询
- results：各工具执行结果的 JSON 字符串，可能包含 maritime、intelligent_qa、daily_report、satellite、news 等类型的数据

## 任务

1. 逐条分析数据：仔细阅读 results 中的每一项具体数据，不要跳读
2. 提取关键实体：找出有名称、有位置、有状态的具体目标
3. 量化描述：用数字说话（数量、距离、速度、坐标）
4. 生成 2-5 条洞察，每条必须包含：
   - 数据支撑：引用具体实体名称、数量、位置、异常指标
   - 逻辑推理：说明从数据到结论的推导过程
   - 风险判断：基于数据评估影响等级
   - 行动建议：给出具体可执行的建议

## 输出格式

必须返回纯 JSON 数组，不要包含 markdown 代码块标记或任何其他说明文字。

输出格式：
[
  {
    "title": "洞察标题（15字以内，包含关键实体或数字）",
    "summary": "一句话摘要（30字以内，必须包含量化信息）",
    "content": "详细分析内容。包含数据依据、推理过程、影响评估、建议措施",
    "riskLevel": "high|medium|low|safe",
    "category": "geopolitics|military|industry|public_opinion"
  }
]

字段约束：
- title：必填，必须包含具体实体名或数字，如"东海3艘高危船舶聚集"
- summary：必填，必须包含量化信息
- content：必填，详细分析，支持 Markdown 格式
- riskLevel：必填，high/medium/low/safe
- category：必填，geopolitics/military/industry/public_opinion

## 规则

1. 绝对禁止空泛结论：
   严禁："海域安全态势整体平稳"、"建议加强监测"、"存在一定风险，需持续关注"
   正确："东海监测到3艘高危船舶，其中油轮_HZ_529与护卫舰_WZ_545距离仅4.1海里，疑似非法补给"

2. 必须引用具体实体：每条洞察至少引用一个具体实体名称或可验证的量化数据

3. 数据真实性：必须基于输入的真实数据生成，严禁编造。数据不足时返回空数组 []

4. 单工具场景处理：只有一个工具结果时深入分析该工具数据，不要因为没有跨工具关联就输出空泛结论

5. 风险判断标准：
   - high：发现明确威胁、重大异常或紧急事态
   - medium：存在潜在风险或值得关注的趋势
   - low：轻微异常或常规监测发现
   - safe：态势平稳、机会点或正面发现（必须有数据支撑）

6. category 判断：
   - geopolitics：涉及多国船只、敏感海域、外交相关、国际新闻中的地缘政治事件
   - military：军舰、军事演习、无人机/侦察机活动、军事冲突或军备动态报道
   - industry：商船、能源运输、渔业、航运安全、经济新闻、行业趋势报道
   - public_opinion：社会舆情、媒体集中报道事件、舆论态势变化（news 工具独有）

7. 空数据处理：如果 results 为空或所有工具都返回失败，返回 []`;

/**
 * 基于所有工具执行结果，调用 DeepSeek 生成综合洞察并入库
 */
export async function generateInsights(
  agentTaskId: string,
  originalQuery: string,
  toolResults: Record<string, unknown>
): Promise<GeneratedInsight[]> {
  if (!DEEPSEEK_API_KEY) {
    console.log("[InsightGenerator] DeepSeek API key not configured, skipping");
    return [];
  }

  // 精简并序列化工具结果
  const compacted = compactToolResults(toolResults);
  const resultsText = safeJsonTruncate(JSON.stringify(compacted, null, 2), 12000);

  console.log(`[InsightGenerator] Generating insights for task ${agentTaskId}`);
  console.log(`[InsightGenerator] Tool results keys:`, Object.keys(toolResults));

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    let resp: Response;
    try {
      resp = await fetch(DEEPSEEK_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `用户原始查询：${originalQuery}\n\n工具执行结果：${resultsText}`,
            },
          ],
          stream: false,
          temperature: 0.3,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`DeepSeek API error: ${resp.status} ${text}`);
    }

    const json = await resp.json();
    const answer = json.choices?.[0]?.message?.content || "";

    const generated = parseInsightsFromText(answer);
    if (generated.length === 0) {
      console.log("[InsightGenerator] No insights generated");
      return [];
    }

    for (const item of generated) {
      const rawCategory = (item as Record<string, unknown>).category as string | undefined;
      const rawRiskLevel = (item as Record<string, unknown>).riskLevel as string | undefined;
      const category = rawCategory === "public_opinion" ? "industry" : (rawCategory || "industry");
      const riskLevel = rawRiskLevel || "medium";
      await db.insert(insights).values({
        category,
        title: item.title,
        summary: item.summary,
        content: item.content,
        riskLevel,
        sources: ["多工具综合研判"],
        agentTaskId,
      });
    }

    console.log(`[InsightGenerator] Generated ${generated.length} insights`);
    return generated;
  } catch (err) {
    console.error("[InsightGenerator] Failed to generate insights:", err);
    return [];
  }
}

/**
 * 从 DeepSeek 返回文本中提取洞察 JSON 数组
 */
function parseInsightsFromText(text: string): GeneratedInsight[] {
  const trimmed = text.trim();

  // 1. 去除 markdown 代码块
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  let candidate = codeBlockMatch ? codeBlockMatch[1].trim() : trimmed;

  // 2. 去除开头的 "json" 标记
  candidate = candidate.replace(/^json\s*/i, "");

  // 3. 直接解析
  try {
    const parsed = JSON.parse(candidate);
    if (Array.isArray(parsed)) {
      return parsed.filter(isValidInsight);
    }
  } catch {
    // continue
  }

  // 4. 从文本中提取 [...] 块
  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.filter(isValidInsight);
      }
    } catch {
      // continue
    }
  }

  return [];
}

/**
 * 精简各工具数据，保留洞察生成所需的关键字段
 */
function compactToolResults(toolResults: Record<string, unknown>): Record<string, unknown> {
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(toolResults)) {
    if (key === "news" && typeof value === "object" && value !== null) {
      const v = value as Record<string, unknown>;
      compacted[key] = {
        query: v.query,
        summary: v.summary,
        keyEntities: v.keyEntities,
        trends: v.trends,
        articles: Array.isArray(v.articles) ? v.articles.slice(0, 5) : v.articles,
      };
    } else {
      compacted[key] = value;
    }
  }
  return compacted;
}

/**
 * 安全截断 JSON 字符串，确保结构完整
 */
function safeJsonTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  let truncated = text.slice(0, maxChars);
  const lastBrace = truncated.lastIndexOf("}");
  const lastBracket = truncated.lastIndexOf("]");
  const cutAt = Math.max(lastBrace, lastBracket);
  if (cutAt > 0) {
    truncated = truncated.slice(0, cutAt + 1);
  }
  return truncated;
}

function isValidInsight(item: unknown): item is GeneratedInsight {
  if (!item || typeof item !== "object") return false;
  const o = item as Record<string, unknown>;
  const hasCoreFields =
    typeof o.title === "string" &&
    o.title.length > 0 &&
    typeof o.summary === "string" &&
    o.summary.length > 0 &&
    typeof o.content === "string" &&
    o.content.length > 0;
  if (!hasCoreFields) return false;

  const validRiskLevels = ["high", "medium", "low", "safe"];
  const validCategories = ["geopolitics", "military", "industry", "public_opinion"];
  if (o.riskLevel != null && !validRiskLevels.includes(o.riskLevel as string)) return false;
  if (o.category != null && !validCategories.includes(o.category as string)) return false;
  return true;
}
