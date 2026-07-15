import { z } from "zod";
import type { ToolDefinition, ToolExecutionContext } from "../../_shared/types.js";

const CDSE_TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const CDSE_CLIENT_ID = process.env.CDSE_CLIENT_ID || "";
const CDSE_CLIENT_SECRET = process.env.CDSE_CLIENT_SECRET || "";

const DEFAULT_VISION_API_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

export function loadVisionModelConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    apiKey: env.VISION_MODEL_API_KEY || env.QWEN_API_KEY || "",
    apiUrl: env.VISION_MODEL_API_URL || env.QWEN_API_URL || DEFAULT_VISION_API_URL,
    model: env.VISION_MODEL_NAME || env.IMAGE_ANALYSIS_MODEL || "",
    timeoutMs: parsePositiveIntegerEnv(
      env.VISION_MODEL_TIMEOUT_MS || env.QWEN_API_TIMEOUT_MS || env.DEEPSEEK_API_TIMEOUT_MS,
      120_000
    ),
  };
}

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB per image
const MAX_TOTAL_IMAGES = 4;
const MAX_RESULT_SIZE_CHARS = 40_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

// ─── CDSE Token ───

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  if (!CDSE_CLIENT_ID || !CDSE_CLIENT_SECRET) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CDSE_CLIENT_ID,
    client_secret: CDSE_CLIENT_SECRET,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("token_timeout"), 10_000);

  try {
    const res = await fetch(CDSE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Token failed: ${res.status}`);
    const json = await res.json() as { access_token: string; expires_in: number };
    cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return cachedToken.token;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Schemas ───

const ImageAnalysisInputSchema = z.strictObject({
  imageUrls: z.array(z.string().trim().min(1)).min(1).max(MAX_TOTAL_IMAGES)
    .describe("List of satellite image URLs to analyze. Supports HTTP/HTTPS URLs and base64 data URIs."),
  analysisType: z.enum(["disaster_assessment", "change_detection", "overview"]).default("overview")
    .describe("Type of analysis to perform. 'disaster_assessment' evaluates disaster damage signs. 'change_detection' compares pre/post disaster images (requires 2+ images). 'overview' provides a general description."),
  context: z.string().trim().min(1).optional()
    .describe("Additional context about the images, e.g. '2024年5月台湾海峡地震后评估' or 'Sentinel-2 true-color image of flood area'."),
});

type ImageAnalysisInput = z.infer<typeof ImageAnalysisInputSchema>;

interface ImageAnalysisOutput {
  summary: string;
  analysisType: string;
  imageCount: number;
  assessment: {
    summary: string;
    affectedAreas: string[];
    severity: "low" | "medium" | "high" | "critical" | "unknown";
    confidence: number;
    changesDetected: string[];
    recommendations: string[];
  };
  rawResponse: string;
}

// ─── Tool Definition ───

export function buildImageAnalysisTool(): ToolDefinition {
  return {
    name: "ImageAnalysis",
    aliases: ["image-analysis"],
    description:
      'Analyze satellite imagery using vision AI. Input: {"imageUrls":["https://...","https://..."],"analysisType":"disaster_assessment","context":"2024年台湾海峡地震后Sentinel-2影像"}. Supports disaster assessment, change detection (2+ images), and general overview. Returns structured assessment with affected areas, severity, confidence, detected changes, and recommendations. Image URLs are downloaded internally; CDSE authentication is handled automatically if configured.',
    kind: "domain",
    inputSchema: ImageAnalysisInputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    maxResultSizeChars: MAX_RESULT_SIZE_CHARS,
    async execute(input, context) {
      const parsed = ImageAnalysisInputSchema.parse(input);
      return executeImageAnalysis(parsed, context);
    },
  };
}

async function executeImageAnalysis(
  input: ImageAnalysisInput,
  context: ToolExecutionContext
): Promise<ImageAnalysisOutput> {
  const { imageUrls, analysisType, context: ctx } = input;
  const visionConfig = loadVisionModelConfig();
  if (!visionConfig.apiKey) {
    throw new Error("VISION_MODEL_API_KEY (or legacy QWEN_API_KEY) is required for image analysis");
  }
  if (!visionConfig.model) {
    throw new Error("VISION_MODEL_NAME is required for image analysis");
  }

  context.onProgress?.({
    stage: "start",
    message: `Analyzing ${imageUrls.length} satellite image(s) (${analysisType})`,
  });

  // Step 1: Download images as base64
  const base64Images: string[] = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    context.onProgress?.({
      stage: "progress",
      message: `Downloading image ${i + 1}/${imageUrls.length}...`,
      percent: Math.round((i / imageUrls.length) * 30),
    });

    try {
      const base64 = await downloadImageAsBase64(url, context.signal);
      base64Images.push(base64);
    } catch (error) {
      context.onProgress?.({
        stage: "warning",
        message: `Failed to download image ${i + 1}: ${formatErrorMessage(error)}`,
      });
    }
  }

  if (base64Images.length === 0) {
    throw new Error("All image downloads failed. Check URLs and authentication.");
  }

  // Step 2: Call the independently configured vision model API
  context.onProgress?.({
    stage: "progress",
    message: `Running vision analysis on ${base64Images.length} image(s)...`,
    percent: 40,
  });

  const rawResponse = await callVisionModel(
    base64Images,
    analysisType,
    visionConfig,
    ctx,
    context.signal
  );

  // Step 3: Parse structured output
  context.onProgress?.({
    stage: "progress",
    message: "Parsing assessment results...",
    percent: 90,
  });

  const assessment = parseAssessment(rawResponse);

  context.onProgress?.({
    stage: "complete",
    message: `Analysis complete: ${assessment.summary.slice(0, 80)}...`,
    data: { severity: assessment.severity, confidence: assessment.confidence },
  });

  return {
    summary: assessment.summary,
    analysisType,
    imageCount: base64Images.length,
    assessment,
    rawResponse: rawResponse.slice(0, 2000), // Truncate for safety
  };
}

// ─── Image Download ───

/** 需要 CDSE OAuth 认证的 Copernicus 相关域名 */
const CDSE_AUTH_DOMAINS = ["dataspace.copernicus.eu", "datahub.creodias.eu"];

function isCdseProtectedUrl(url: string): boolean {
  return CDSE_AUTH_DOMAINS.some((domain) => url.includes(domain));
}

/** 验证 HTTP Content-Type 是否为常见图片类型，或 application/octet-stream（CDSE 经常返回此类型） */
function isImageContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const trimmed = contentType.trim().toLowerCase();
  if (/^image\/(jpeg|jpg|png|gif|webp|bmp|tiff?)$/i.test(trimmed)) return true;
  // CDSE thumbnail/quicklook URLs often return application/octet-stream; validate by magic bytes later
  if (trimmed === "application/octet-stream") return true;
  return false;
}

/** 通过文件魔数验证是否为 JPEG 或 PNG */
function validateImageMagicBytes(buffer: Buffer): void {
  if (buffer.length < 8) {
    throw new Error("Downloaded data too small to be a valid image");
  }
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isGif = buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46;
  const isWebp = buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42;
  if (!isJpeg && !isPng && !isGif && !isWebp) {
    throw new Error("Downloaded data is not a recognized image format (JPEG/PNG/GIF/WebP)");
  }
}

async function downloadImageAsBase64(url: string, signal?: AbortSignal): Promise<string> {
  // If already a data URI, return as-is
  if (url.startsWith("data:")) return url;

  // For CDSE/Creodias URLs, always include the OAuth token on the first request
  // to avoid 401/403 and to get proper image data instead of error pages.
  let response: Response;
  if (isCdseProtectedUrl(url)) {
    const token = await getAccessToken();
    response = await fetchImage(url, token ?? undefined, signal);
  } else {
    response = await fetchImage(url, undefined, signal);
  }

  // If unauthorized and it's a CDSE/Creodias URL, retry with token
  if ((response.status === 401 || response.status === 403) && isCdseProtectedUrl(url)) {
    const token = await getAccessToken();
    if (token) {
      response = await fetchImage(url, token, signal);
    }
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type");
  if (!isImageContentType(contentType)) {
    throw new Error(`Unexpected content-type '${contentType ?? "unknown"}', expected an image`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(`Image too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB > ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB)`);
  }
  if (buffer.length < 100) {
    throw new Error(`Image too small (${buffer.length} bytes), likely empty`);
  }

  validateImageMagicBytes(buffer);

  // Use a concrete image MIME type for the data URI; fall back to image/jpeg if the server returned octet-stream
  const concreteContentType =
    contentType && contentType.trim().toLowerCase() !== "application/octet-stream"
      ? contentType.trim()
      : "image/jpeg";
  return `data:${concreteContentType};base64,${buffer.toString("base64")}`;
}

async function fetchImage(url: string, token: string | undefined, signal?: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("download_timeout"), DEFAULT_REQUEST_TIMEOUT_MS);
  const abortFromParent = () => controller.abort(signal?.reason ?? "aborted");
  if (signal?.aborted) abortFromParent();
  signal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromParent);
  }
}

// ─── Vision model API ───

async function callVisionModel(
  base64Images: string[],
  analysisType: string,
  visionConfig: ReturnType<typeof loadVisionModelConfig>,
  context?: string,
  parentSignal?: AbortSignal
): Promise<string> {
  const systemPrompt = buildSystemPrompt(analysisType);
  const userText = buildUserPrompt(analysisType, context, base64Images.length);

  const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
    { type: "text", text: userText },
    ...base64Images.map((img) => ({
      type: "image_url" as const,
      image_url: { url: img },
    })),
  ];

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), visionConfig.timeoutMs);
  const abortFromParent = () => abortController.abort(parentSignal?.reason ?? "aborted");
  if (parentSignal?.aborted) abortFromParent();
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    const response = await fetch(visionConfig.apiUrl, {
      method: "POST",
      signal: abortController.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${visionConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: visionConfig.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: content as unknown as string },
        ],
        max_tokens: 4000,
        temperature: 0.2,
        stream: false,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Vision model API error: ${response.status} ${text}`);
    }

    const json = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (json.error) {
      throw new Error(`Vision model error: ${json.error.message ?? JSON.stringify(json.error)}`);
    }

    const content_text = json.choices?.[0]?.message?.content;
    if (typeof content_text !== "string") {
      throw new Error("Vision model response missing content");
    }

    return content_text;
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new Error(`Vision model API request timed out after ${visionConfig.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

function buildSystemPrompt(analysisType: string): string {
  const base = `你是一个专业的遥感图像分析专家。你的任务是分析卫星图像并输出结构化的 JSON 评估报告。

严格要求：
1. 输出必须是有效的纯 JSON，不要包含 markdown 代码块标记（如 \`\`\`json）
2. 所有文本字段使用中文
3. confidence 必须是 0.0 到 1.0 之间的数字
4. severity 必须是以下之一："low", "medium", "high", "critical", "unknown"
5. 如果图像质量差或无法判断，如实说明，不要编造

输出格式：
{
  "summary": "总体评估摘要（100字以内）",
  "affectedAreas": ["受灾/变化区域1描述", "受灾/变化区域2描述"],
  "severity": "low|medium|high|critical|unknown",
  "confidence": 0.85,
  "changesDetected": ["发现的变化1", "发现的变化2"],
  "recommendations": ["建议1", "建议2"]
}`;

  if (analysisType === "disaster_assessment") {
    return base + `

当前分析类型：灾情评估
- 重点关注灾害迹象：洪水淹没区、建筑损毁、道路中断、山体滑坡、火灾痕迹、地震裂缝等
- 评估受灾范围和严重程度
- 如果图像是灾前灾后对比，明确指出变化区域`;
  }

  if (analysisType === "change_detection") {
    return base + `

当前分析类型：变化检测
- 对比多张图像，识别时间上的地表变化
- 重点关注：新增建筑、植被变化、水体变化、土地利用变化、灾害痕迹
- 对每张图像标注拍摄时间（如果有）
- 用箭头或"→"表示变化方向：如"农田→建筑用地"`;
  }

  return base + `

当前分析类型：一般概述
- 描述图像中的地理特征：地形、水体、植被、建筑、道路等
- 评估图像质量和云量影响
- 指出任何值得注意的特征或异常`;
}

function buildUserPrompt(analysisType: string, context?: string, imageCount: number = 1): string {
  let prompt = `请分析以下${imageCount}张卫星图像`;
  if (analysisType === "change_detection" && imageCount >= 2) {
    prompt += "，进行灾前灾后变化检测对比";
  } else if (analysisType === "disaster_assessment") {
    prompt += "，进行灾情评估";
  } else {
    prompt += "，提供综合概述";
  }

  if (context) {
    prompt += `。背景信息：${context}`;
  }

  prompt += "。请按照系统提示中的 JSON 格式返回分析结果。";
  return prompt;
}

// ─── Parse Assessment ───

function parseAssessment(raw: string): ImageAnalysisOutput["assessment"] {
  // Try to extract JSON from the response (in case there's extra text)
  let jsonText = raw.trim();

  // Remove markdown code blocks
  const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonText = codeBlockMatch[1].trim();
  }

  // Try to find JSON object
  const objectMatch = jsonText.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonText = objectMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;

    return {
      summary: String(parsed.summary ?? "无法生成评估摘要"),
      affectedAreas: Array.isArray(parsed.affectedAreas) ? parsed.affectedAreas.map(String) : [],
      severity: validateSeverity(parsed.severity),
      confidence: validateConfidence(parsed.confidence),
      changesDetected: Array.isArray(parsed.changesDetected) ? parsed.changesDetected.map(String) : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map(String) : [],
    };
  } catch {
    // Fallback: parse the raw text as best as possible
    return {
      summary: raw.slice(0, 500),
      affectedAreas: [],
      severity: "unknown",
      confidence: 0,
      changesDetected: [],
      recommendations: ["JSON 解析失败，请参考 rawResponse 字段查看原始输出"],
    };
  }
}

function validateSeverity(value: unknown): "low" | "medium" | "high" | "critical" | "unknown" {
  const valid = ["low", "medium", "high", "critical", "unknown"] as const;
  if (typeof value === "string" && valid.includes(value as typeof valid[number])) {
    return value as typeof valid[number];
  }
  return "unknown";
}

function validateConfidence(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(num)) {
    return Math.max(0, Math.min(1, num));
  }
  return 0;
}

// ─── Helpers ───

function parsePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
