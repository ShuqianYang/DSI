import crypto from "crypto";

// 网关配置（从环境变量读取）
const GATEWAY_BASE_URL = process.env.GATEWAY_BASE_URL || "http://192.168.0.136";
const ACCESS_KEY = process.env.GATEWAY_ACCESS_KEY || "";
const SECRET_KEY = process.env.GATEWAY_SECRET_KEY || "";

/** 需求提交数据 */
export interface RequirementSubmitData {
  name: string;
  description: string;
  applicationScenario: string;
  type?: number;
}

/** 提交结果 */
export interface SubmitResult {
  success: boolean;
  status?: number;
  error?: string;
}

/**
 * 生成签名: MD5(secretKey + timestamp)
 */
function generateSignature(secretKey: string, timestamp: number): string {
  return crypto.createHash("md5").update(secretKey + timestamp).digest("hex");
}

/**
 * 提交需求到外部需求管理平台
 *
 * 失败时 catch，不影响主流程
 */
export async function submitToExternalSystem(
  data: RequirementSubmitData
): Promise<SubmitResult> {
  // 未配置密钥时直接跳过
  if (!ACCESS_KEY || !SECRET_KEY) {
    console.log("[ExternalSubmit] Gateway credentials not configured, skipping");
    return { success: false, error: "Gateway credentials not configured" };
  }

  const timestamp = Date.now();
  const signature = generateSignature(SECRET_KEY, timestamp);
  const url = `${GATEWAY_BASE_URL}/sys-service-web/sysBackend/gt/requirement/issue`;

  const body = {
    applicant: "数智融合智能体应用平台",
    applicationScenario: data.applicationScenario,
    description: data.description,
    name: data.name,
    source: "智能体平台",
    status: 0,
    type: String(data.type ?? 1),
  };

  console.log(`[ExternalSubmit] POST ${url}`);
  console.log(`[ExternalSubmit] name: ${data.name}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accessKey: ACCESS_KEY,
        timestamp: String(timestamp),
        signature,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const respBody = await resp.text();
    console.log(`[ExternalSubmit] Status: ${resp.status}, body: ${respBody.slice(0, 200)}`);

    if (resp.ok) {
      return { success: true, status: resp.status };
    }

    return {
      success: false,
      status: resp.status,
      error: `HTTP ${resp.status}: ${respBody.slice(0, 200)}`,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[ExternalSubmit] Failed:", errorMsg);
    return { success: false, error: errorMsg };
  }
}
