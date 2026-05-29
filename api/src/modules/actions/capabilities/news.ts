import { v4 as uuidv4 } from "uuid";
import type { Action, ActionResult } from "@datasourceintelligence/shared";
import type { Capability } from "../types.js";
import { callDifyChat } from "../../../lib/dify.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ==================== 火山引擎搜索 API ====================
const VOLCANO_SEARCH_API_KEY = process.env.VOLCANO_SEARCH_API_KEY || "";
const VOLCANO_SEARCH_API_URL = "https://open.feedcoopapi.com/search_api/web_search";

interface VolcanoWebResult {
  Id: string;
  SortId: number;
  Title: string;
  SiteName: string;
  Url: string;
  Snippet: string;
  Summary: string;
  Content: string;
  PublishTime: string;
  LogoUrl: string;
  RankScore: number;
  AuthInfoDes: string;
  AuthInfoLevel: number;
  ContentFormats: string;
}

interface VolcanoSearchResult {
  ResponseMetadata: {
    RequestId: string;
    Error?: { Code: string; CodeN?: number; Message: string };
  };
  Result: {
    ResultCount: number;
    WebResults: VolcanoWebResult[];
    SearchContext: { OriginQuery: string; SearchType: string };
    TimeCost: number;
    LogId: string;
  } | null;
}

async function volcanoSearch(options: {
  query: string;
  count?: number;
  summary?: boolean;
  timeoutMs?: number;
}): Promise<VolcanoSearchResult | null> {
  const { query, count = 10, summary = true, timeoutMs = 60000 } = options;

  if (!VOLCANO_SEARCH_API_KEY) {
    console.warn("[VolcanoSearch] VOLCANO_SEARCH_API_KEY not configured, returning null");
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(VOLCANO_SEARCH_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VOLCANO_SEARCH_API_KEY}`,
      },
      body: JSON.stringify({
        Query: query,
        SearchType: "web",
        Count: count,
        Filter: {
          NeedContent: true,
          NeedUrl: true,
          Sites: "",
          BlockHosts: "",
          AuthInfoLevel: 0,
        },
        NeedSummary: summary,
        TimeRange: "",
        QueryControl: { QueryRewrite: false },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Volcano API error: ${resp.status} ${body.slice(0, 200)}`);
    }

    const data = (await resp.json()) as VolcanoSearchResult;

    if (data.ResponseMetadata?.Error) {
      const err = data.ResponseMetadata.Error;
      throw new Error(`Volcano API business error: ${err.Code} ${err.Message}`);
    }

    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Volcano API timeout after ${timeoutMs}ms`);
    }
    throw err;
  }
}

// DeepSeek API 配置
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-v4-flash";

const DEEPSEEK_TIMEOUT_MS = 120_000;

async function callDeepSeekApi(
  messages: Array<{ role: string; content: string }>,
  options: Record<string, unknown> = {}
): Promise<string> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("DeepSeek API key not configured");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS);
  try {
    const resp = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({ model: DEEPSEEK_MODEL, messages, stream: false, ...options }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`DeepSeek API error: ${resp.status} ${text}`);
    }
    const json = await resp.json();
    return json.choices?.[0]?.message?.content || "";
  } finally {
    clearTimeout(timeout);
  }
}

// ==================== JSON 解析器（容错） ====================
function parseNewsResult(answer: string): Record<string, unknown> | null {
  console.log("[News] Raw answer length:", answer.length);
  console.log("[News] Raw answer preview:", answer.slice(0, 300));

  // 1. 去除 markdown 代码块后解析
  try {
    let cleaned = answer.trim();
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      cleaned = codeBlockMatch[1].trim();
      console.log("[News] Stripped code block, cleaned length:", cleaned.length);
    }
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object") {
      console.log("[News] Parsed successfully (direct)");
      return parsed as Record<string, unknown>;
    }
  } catch (e) {
    console.log("[News] Direct parse failed:", (e as Error).message);
  }

  // 2. 从文本中提取 {...} 块（贪婪匹配最后一个闭合的 JSON）
  const match = answer.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed && typeof parsed === "object") {
        console.log("[News] Parsed successfully (regex extract)");
        return parsed as Record<string, unknown>;
      }
    } catch (e) {
      console.log("[News] Regex extract parse failed:", (e as Error).message);
    }
  }

  console.warn("[News] Failed to parse answer as JSON");
  return null;
}

// ==================== Mock 数据生成器 ====================
function buildMockResult(query: string, region: string, timeRange: string): Record<string, unknown> {
  const now = new Date();
  const timeSpanEnd = now.toISOString().split("T")[0];
  const timeSpanStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const regionLabel = region || (query.includes("南海") ? "南海" : query.includes("东海") ? "东海" : "全球");

  return {
    success: true,
    query,
    searchParams: {
      region: regionLabel,
      timeRange,
      maxResults: 10,
      language: "zh",
    },
    summary: {
      totalFound: 15,
      totalReturned: 10,
      timeSpan: `${timeSpanStart} 至 ${timeSpanEnd}`,
      overview: `近期${regionLabel}区域舆情热度上升，多家权威媒体集中报道海上对峙事件，菲律宾方面多次提及补给受阻，中国海警执法力度明显加强。`,
    },
    articles: [
      {
        id: "news-1",
        title: "中国海警在南海仁爱礁附近水域依法驱离菲律宾船只",
        source: "新华社",
        url: "https://example.com/news-1",
        publishedAt: "2026-04-26T08:30:00Z",
        summary: "中国海警局新闻发言人表示，4月25日，菲律宾船只擅自闯入仁爱礁邻近海域，中国海警依法实施跟监警戒、航路管制，予以驱离。",
        relevanceScore: 0.95,
        tags: ["军事", "南海"],
        language: "zh",
      },
      {
        id: "news-2",
        title: "菲律宾称补给船只在南海遭中方水炮拦截",
        source: "联合早报",
        url: "https://example.com/news-2",
        publishedAt: "2026-04-25T14:20:00Z",
        summary: "菲律宾海岸警卫队称，两艘菲方补给船在仁爱礁附近遭中国海警船水炮拦截，被迫返航。菲方称此为'侵略性行为'。",
        relevanceScore: 0.92,
        tags: ["军事", "南海"],
        language: "zh",
      },
      {
        id: "news-3",
        title: "美军印太司令部司令称将加强与菲方南海联合巡逻",
        source: "路透社",
        url: "https://example.com/news-3",
        publishedAt: "2026-04-24T10:15:00Z",
        summary: "美军印太司令部司令阿奎利诺表示，美国将加强与菲律宾的南海联合巡逻，以'维护航行自由'。",
        relevanceScore: 0.88,
        tags: ["军事", "南海", "国际关系"],
        language: "zh",
      },
    ],
    keyEntities: [
      { name: "仁爱礁", type: "location", mentions: 8, relatedArticles: ["news-1", "news-2"] },
      { name: "菲律宾", type: "organization", mentions: 6, relatedArticles: ["news-2", "news-3"] },
      { name: "中国海警", type: "organization", mentions: 5, relatedArticles: ["news-1", "news-2"] },
    ],
    trends: [
      { topic: "海上对峙", description: "中菲船只在仁爱礁附近发生多次近距离对峙", articleCount: 5, sentiment: "negative" },
      { topic: "美军介入", description: "美方表态支持菲律宾，联合巡逻预期升温", articleCount: 3, sentiment: "negative" },
    ],
    sources: [
      { id: 1, name: "新华社", url: "https://example.com", articleCount: 1 },
      { id: 2, name: "联合早报", url: "https://example.com", articleCount: 1 },
      { id: 3, name: "路透社", url: "https://example.com", articleCount: 1 },
    ],
    toolsUsed: ["volcano_search"],
    metadata: {
      searchTime: now.toISOString(),
      dataFreshness: "realtime",
      confidence: "high",
    },
  };
}

// ==================== Capability 定义 ====================
export const newsCapability: Capability = {
  name: "news",
  description: "实时新闻查询：根据关键词、区域、时间范围检索最新新闻资讯，支持态势关联分析",

  execute: async (action: Action, _context?: Record<string, unknown>): Promise<ActionResult> => {
    const startTime = Date.now();
    const params = action.params as {
      query?: string;
      keyword?: string;
      region?: string;
      timeRange?: string;
      fireScenario?: boolean;
      earthquakeScenario?: boolean;
    };
    const query = params.query || params.keyword || "未指定查询";
    const region = params.region || "";
    const timeRange = params.timeRange || "7d";

    // ========== 火情研判 scenario：返回火情新闻 mock ==========
    if (params.fireScenario === true) {
      await sleep(1500);
      const regionName = region || "未知区域";

      // 以火点为中心，50km × 50km 的搜索矩形
      // 43.26°N 处 1° 经度 ≈ 81.15km，1° 纬度 ≈ 111.32km
      const fireLng = 76.998;
      const fireLat = 43.2635;
      const west = 76.690;
      const south = 43.039;
      const east = 77.306;
      const north = 43.488;
      const centerLng = fireLng;
      const centerLat = fireLat;

      const gisData = {
        type: "region" as const,
        regions: [
          {
            id: "region-fire-news-border",
            name: regionName,
            type: "monitor",
            coordinates: [
              [west, south],
              [east, south],
              [east, north],
              [west, north],
              [west, south],
            ] as [number, number][],
            style: {
              fill: true,
              fillColor: "rgba(255, 42, 42, 0.08)",
              outlineColor: "#ff2a2a",
              outlineWidth: 2,
              effect: "lightWall",
            },
            label: {
              text: `${regionName}\n东经 ${west}°–${east}° / 北纬 ${south}°–${north}°`,
              position: [centerLng, centerLat] as [number, number],
            },
          },
        ],
        entities: [
          {
            id: "fire-center-news",
            name: `${regionName} 火灾中心`,
            type: "fire",
            coordinates: [fireLng, fireLat] as [number, number],
            importance: "high",
            status: "danger",
            size: 28,
            color: "#FF4444",
            imageUrl: "/cesium/Assets/Images/fire-point.png",
          },
        ],
        eventName: "news-fire",
        cameraView: {
          type: "point" as const,
          lng: centerLng,
          lat: centerLat,
          altitude: 100_000,
        },
      };

      return {
        success: true,
        data: {
          summary: {
            overview: `检索到 ${regionName} 近期火情相关报道 5 条，舆情呈负面趋势，需重点关注。`,
            totalFound: 5,
            totalReturned: 5,
          },
          gisData,
          articles: [
            {
              title: "新疆边境某管段附近发现可疑烟柱",
              source: "某地方新闻",
              publishedAt: "2026-05-14T08:30:00Z",
              summary: "边境牧民反映某管段附近出现不明烟柱，疑似野外火情。",
              relevanceScore: 0.92,
              tags: ["火情", "边境"],
            },
            {
              title: "哈萨克斯坦北部草原火灾蔓延，边境地区需警惕",
              source: "国际观察",
              publishedAt: "2026-05-13T14:20:00Z",
              summary: "哈国北部草原火灾已烧毁约500公顷，风向朝边境方向。",
              relevanceScore: 0.88,
              tags: ["火情", "跨境"],
            },
            {
              title: "边境地区部署加强防火巡查力量",
              source: "官方通报",
              publishedAt: "2026-05-12T10:15:00Z",
              summary: "相关部门已增派巡查力量，重点监控边境草原火险。",
              relevanceScore: 0.85,
              tags: ["防火", "边境"],
            },
            {
              title: "气象部门发布高温干旱预警，火险等级提升",
              source: "气象新闻",
              publishedAt: "2026-05-11T09:00:00Z",
              summary: "未来一周边境地区持续高温少雨，火险等级升至橙色。",
              relevanceScore: 0.80,
              tags: ["气象", "预警"],
            },
            {
              title: "某边境口岸附近发现过火痕迹，面积待确认",
              source: "现场报道",
              publishedAt: "2026-05-10T16:45:00Z",
              summary: "口岸工作人员发现边境线附近有过火痕迹，已上报核查。",
              relevanceScore: 0.78,
              tags: ["火情", "核查"],
            },
          ],
          trends: [
            {
              topic: "边境火情",
              description: "近期边境地区火情线索集中出现",
              articleCount: 5,
              sentiment: "negative",
            },
          ],
        },
        metadata: {
          capability: "news",
          executionTime: Date.now() - startTime,
          mock: true,
          responseType: "fire-scenario",
        },
      };
    }

    // ========== 地震灾后评估 scenario：返回地震权威基础信息 mock ==========
    if (params.earthquakeScenario === true) {
      await sleep(1500);
      const regionName = region || "广西柳州市柳南区";
      const epicenterLng = 109.26;
      const epicenterLat = 24.38;

      return {
        success: true,
        data: {
          summary: {
            overview: `已从中国地震台网中心、广西地震局官网获取 ${regionName} 地震权威基础信息，国家与省级数据核验一致。`,
            totalFound: 3,
            totalReturned: 3,
            dataSource: "中国地震台网中心、广西壮族自治区地震局（官方核验一致）",
          },
          articles: [
            {
              title: "中国地震台网正式测定：广西柳州市柳南区发生5.2级地震",
              source: "中国地震台网中心",
              publishedAt: "2026-05-18T00:21:04Z",
              summary: "发震时刻：2026-05-18 00:21:04，震中位置：广西柳州市柳南区，经度109.26°，纬度24.38°，震源深度8千米，震级5.2级。",
              relevanceScore: 0.99,
              tags: ["地震", "权威发布"],
            },
            {
              title: "广西壮族自治区地震局发布地震速报",
              source: "广西壮族自治区地震局",
              publishedAt: "2026-05-18T00:25:00Z",
              summary: "广西地震局确认：柳州柳南区5.2级地震参数与中国地震台网中心一致，已启动应急响应。",
              relevanceScore: 0.97,
              tags: ["地震", "地方通报"],
            },
            {
              title: "应急管理部启动地震灾害四级应急响应",
              source: "应急管理部",
              publishedAt: "2026-05-18T01:00:00Z",
              summary: "针对广西柳州5.2级地震，应急管理部启动四级应急响应，派出工作组赶赴灾区。",
              relevanceScore: 0.92,
              tags: ["应急响应", "救灾"],
            },
          ],
          keyEntities: [
            { name: "广西柳州市柳南区", type: "location", mentions: 5, relatedArticles: ["news-1", "news-2"] },
            { name: "中国地震台网中心", type: "organization", mentions: 3, relatedArticles: ["news-1"] },
            { name: "广西地震局", type: "organization", mentions: 3, relatedArticles: ["news-2"] },
          ],
          trends: [
            { topic: "地震速报", description: "国家与省级地震局同步发布权威参数，数据核验一致", articleCount: 2, sentiment: "neutral" },
            { topic: "应急响应", description: "应急管理部启动四级响应，工作组已赶赴灾区", articleCount: 1, sentiment: "negative" },
          ],
          // 地震权威基础信息结构化数据
          earthquakeInfo: {
            eventTime: "2026-05-18 00:21:04",
            location: "广西柳州市柳南区",
            longitude: 109.26,
            latitude: 24.38,
            depthKm: 8,
            magnitude: 5.2,
            dataSources: ["中国地震台网中心", "广西壮族自治区地震局"],
            verificationStatus: "官方核验一致",
          },
        },
        metadata: {
          capability: "news",
          executionTime: Date.now() - startTime,
          mock: true,
          responseType: "earthquake-scenario",
        },
      };
    }

    // ========== 暴雨洪涝灾后评估 scenario：返回暴雨权威基础信息 mock ==========
    if ((action.params as any).floodScenario === true) {
      await sleep(1500);
      const regionName = region || "湖南石门县";

      return {
        success: true,
        data: {
          summary: {
            overview: `已从国家气象信息中心、湖南省气象局、水利部水文信息官网获取 ${regionName} 暴雨洪涝权威基础信息，国家与省级数据核验一致。`,
            totalFound: 3,
            totalReturned: 3,
            dataSource: "国家气象信息中心、湖南省气象局、水利部水文信息官网（官方核验一致）",
          },
          articles: [
            {
              title: "国家气象信息中心：湖南石门县出现极端暴雨过程",
              source: "国家气象信息中心",
              publishedAt: "2026-05-18T08:00:00Z",
              summary: "5月17日08:00强降雨云团进入澧水流域（湖南石门县段），累计降雨量超历史同期极值，引发严重洪涝灾害。",
              relevanceScore: 0.99,
              tags: ["暴雨", "权威发布"],
            },
            {
              title: "湖南省气象局发布暴雨红色预警",
              source: "湖南省气象局",
              publishedAt: "2026-05-17T14:00:00Z",
              summary: "湖南省气象局于5月17日14:00发布暴雨红色预警：渫水（石门段）水位快速上涨，超警戒水位2.3米，澧水流域全线告急。",
              relevanceScore: 0.97,
              tags: ["暴雨", "预警"],
            },
            {
              title: "水利部水文信息官网：张家渡大桥因洪水冲击坍塌",
              source: "水利部水文信息官网",
              publishedAt: "2026-05-18T06:30:00Z",
              summary: "渫水石门段水位超保证水位，流速达历史极值。张家渡大桥（110.8946°E, 29.8815°N）于5月18日凌晨因洪水冲击发生结构性坍塌。",
              relevanceScore: 0.95,
              tags: ["洪水", "桥梁损毁"],
            },
          ],
          keyEntities: [
            { name: "湖南石门县", type: "location", mentions: 5, relatedArticles: ["news-1", "news-2"] },
            { name: "张家渡大桥", type: "location", mentions: 3, relatedArticles: ["news-3"] },
            { name: "澧水流域", type: "location", mentions: 4, relatedArticles: ["news-1", "news-2"] },
            { name: "渫水", type: "location", mentions: 3, relatedArticles: ["news-2", "news-3"] },
          ],
          trends: [
            { topic: "极端暴雨", description: "石门县累计降雨量超历史同期极值，引发严重洪涝", articleCount: 2, sentiment: "negative" },
            { topic: "桥梁坍塌", description: "张家渡大桥因洪水冲击发生结构性坍塌", articleCount: 1, sentiment: "negative" },
          ],
          floodInfo: {
            eventName: "湖南石门县极端暴雨洪涝",
            eventTime: "2026-05-17~05-18",
            keyProcess: [
              { time: "5-17 08:00", event: "强降雨云团进入澧水流域（湖南石门县段）" },
              { time: "5-17 14:00", event: "水文站监测渫水（石门段）水位快速上涨，超警戒水位" },
              { time: "5-18 凌晨", event: "张家渡大桥因洪水冲击发生结构性坍塌" },
            ],
            keyDisaster: "张家渡大桥坍塌",
            bridgeCoordinates: [110.89457167309149, 29.881490688312095],
            dataSources: ["国家气象信息中心", "湖南省气象局", "水利部水文信息官网"],
            verificationStatus: "官方核验一致",
          },
        },
        metadata: {
          capability: "news",
          executionTime: Date.now() - startTime,
          mock: true,
          responseType: "flood-scenario",
        },
      };
    }

    // ========== DeepSeek + 火山引擎实时搜索 ==========
    try {
      // 1. DeepSeek 提取搜索关键词
      let searchQuery = query;
      try {
        const keywordPrompt = `你是搜索关键词提取器。根据用户提问，提取最适合用于新闻/舆情搜索的关键词（简洁，2-5个词）。只返回关键词，不要其他内容。

用户提问："${query}"`;
        const keywordResult = await callDeepSeekApi([
          { role: "system", content: "你是一个搜索关键词提取专家。" },
          { role: "user", content: keywordPrompt },
        ]);
        searchQuery = keywordResult.trim() || query;
        console.log(`[News] DeepSeek keyword extract: "${searchQuery}"`);
      } catch (keywordErr) {
        console.warn("[News] DeepSeek keyword extract failed, using original query:", keywordErr);
      }

      // 2. 火山引擎实时搜索
      const volcanoResult = await volcanoSearch({
        query: searchQuery,
        count: 8,
        summary: true,
        timeoutMs: 60000,
      });

      const volcanoPages = volcanoResult?.Result?.WebResults || [];

      if (!volcanoPages.length) {
        return {
          success: true,
          data: {
            summary: { overview: "未检索到相关新闻", totalFound: 0, totalReturned: 0 },
            articles: [],
            trends: [],
          },
          metadata: {
            capability: "news",
            executionTime: Date.now() - startTime,
            source: "volcano",
            mock: false,
          },
        };
      }

      // 3. DeepSeek 格式化搜索结果
      try {
        const formatPrompt = `你是新闻整理助手。请将以下搜索结果整理为结构化 JSON。

用户原始提问：${query}
搜索关键词：${searchQuery}

搜索结果：
${volcanoPages.map((r, i) => `${i + 1}. ${r.Title}
   来源：${r.Url}
   发布时间：${r.PublishTime || "未知"}
   内容摘要：${r.Snippet.slice(0, 300)}`).join("\n\n")}

请返回以下格式的 JSON：
{
  "summary": {
    "overview": "用一段话概括整体舆情态势",
    "totalFound": ${volcanoPages.length},
    "totalReturned": ${volcanoPages.length}
  },
  "articles": [
    {
      "title": "标题",
      "source": "来源网站名",
      "url": "链接",
      "publishedAt": "ISO时间",
      "summary": "200字以内的摘要",
      "relevanceScore": 0.95,
      "tags": ["标签1", "标签2"]
    }
  ],
  "trends": [
    {
      "topic": "趋势主题",
      "description": "趋势描述",
      "articleCount": 3,
      "sentiment": "positive|neutral|negative"
    }
  ],
  "keyEntities": [
    { "name": "实体名", "type": "location|organization|person", "mentions": 5 }
  ]
}

只返回 JSON，不要其他内容。`;

        const formatResult = await callDeepSeekApi([
          { role: "system", content: "你是一个新闻整理专家，只返回 JSON。" },
          { role: "user", content: formatPrompt },
        ], { reasoning_effort: "high" });

        // 解析 JSON（容错处理 markdown 代码块）
        let cleaned = formatResult.trim();
        const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) {
          cleaned = codeBlockMatch[1].trim();
        }
        const parsed = JSON.parse(cleaned);

        if (parsed && typeof parsed === "object" && Array.isArray(parsed.articles)) {
          return {
            success: true,
            data: parsed,
            metadata: {
              capability: "news",
              executionTime: Date.now() - startTime,
              source: "volcano+deepseek",
              searchQuery,
            },
          };
        }
      } catch (formatErr) {
        console.warn("[News] DeepSeek format failed, falling back to raw volcano:", formatErr);
      }

      // DeepSeek 格式化失败：返回原始火山引擎结果
      return {
        success: true,
        data: {
          summary: {
            overview: `检索到 ${volcanoPages.length} 条相关新闻`,
            totalFound: volcanoPages.length,
            totalReturned: volcanoPages.length,
          },
          articles: volcanoPages.map((r) => ({
            title: r.Title,
            source: r.SiteName || new URL(r.Url).hostname,
            url: r.Url,
            publishedAt: r.PublishTime || "",
            summary: r.Snippet.slice(0, 200),
            relevanceScore: r.RankScore || 0.8,
            tags: [],
          })),
          trends: [],
        },
        metadata: {
          capability: "news",
          executionTime: Date.now() - startTime,
          source: "volcano-raw",
          searchQuery,
        },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("[News] DeepSeek + 火山引擎 failed:", errorMsg);

      // 超时或失败：返回提示
      return {
        success: true,
        data: {
          summary: { overview: "搜索超时，未获取到结果。请稍后重试或更换关键词。", totalFound: 0, totalReturned: 0 },
          articles: [],
          trends: [],
        },
        metadata: {
          capability: "news",
          executionTime: Date.now() - startTime,
          source: "volcano",
          error: errorMsg,
        },
      };
    }

    /*
    // Dify 路径（已注释，保留备用）
    const difyApiKey = process.env.DIFY_NEWS_API_KEY;
    const difyApiUrl = process.env.DIFY_NEWS_API_URL;
    if (difyApiKey && difyApiUrl) {
      try {
        const result = await callDifyChat({ apiKey: difyApiKey, apiUrl: difyApiUrl, query, inputs: { query, region, timeRange }, timeoutMs: 240_000 });
        const parsed = parseNewsResult(result.answer);
        if (parsed && parsed.articles && Array.isArray(parsed.articles)) {
          return { success: true, data: parsed, metadata: { capability: "news", executionTime: Date.now() - startTime, source: "dify" } };
        }
      } catch (err) {
        console.error("[News] Dify call failed:", err);
      }
    }
    */

    // 兜底：Mock 数据（火山引擎完全不可用时）
    await sleep(1800);
    const mockData = buildMockResult(query, region, timeRange);

    return {
      success: true,
      data: mockData,
      metadata: {
        capability: "news",
        executionTime: Date.now() - startTime,
        mock: true,
      },
    };
  },
};
