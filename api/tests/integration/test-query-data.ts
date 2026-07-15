/**
 * 1.1.1 影像切片数据检索接口测试
 * 地址: POST http://192.168.0.129:5000/agent/queryData
 *
 * 请求参数（Content-Type: application/json）:
 * {
 *   "pageNo": 1,
 *   "pageSize": 10,
 *   "satelliteName": "",
 *   "payloadType": ["红外", "可见光"],
 *   "productType": "标准影像",
 *   "productTypes": ["标准影像", "目标切片"],
 *   "dataType": "火情",
 *   "targetType": "火情",
 *   "messageTypes": ["SLICE", "IMAGE"],
 *   "eventCodes": ["slice", "satelliteimage"],
 *   "startAcquisitionTime": 1710424725000,
 *   "endAcquisitionTime": 1741960725000,
 *   "timeRange": ["2026-03-12 00:00:00", "2026-03-30 00:00:00"],
 *   "timeRanges": [1710424725000, 1741960725000],
 *   "resolution": 1,
 *   "maximumCloudCover": 0.2,
 *   "keyword": "高分",
 *   "reqObj": "东海油模",
 *   "reqContent": "接收到天元认知计算系统的历史影像查询(油膜)需求，完成影像检索并反馈"
 * }
 *
 * 响应格式:
 * {
 *   "state": true,
 *   "message": "操作成功",
 *   "value": { "current": 1, "size": 1, "total": 40, "pages": 40, "records": [...] },
 *   "code": 200,
 *   "errorCode": "200"
 * }
 */

const URL = "http://192.168.0.129:5000/agent/queryData";

const payload = {
  pageNo: 1,
  pageSize: 10,
  satelliteName: "高分五号A星",
  payloadType: ["红外"],
  productType: "目标切片",
  dataType: "漏油",
  targetType: "漏油",
  reqObj: "智能体",
  reqContent: "漏油",
};

async function main() {
  console.log(`[QueryData] POST ${URL}`);
  console.log("[QueryData] Payload:", JSON.stringify(payload, null, 2));

  const start = Date.now();
  try {
    const resp = await fetch(URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const elapsed = Date.now() - start;
    console.log(`\n[QueryData] Status: ${resp.status} ${resp.statusText} (${elapsed}ms)`);

    const body = await resp.text();
    console.log("[QueryData] Raw response:\n", body);

    try {
      const json = JSON.parse(body);
      console.log("[QueryData] Parsed keys:", Object.keys(json));
      if (json.value) {
        console.log("[QueryData] Page info:", {
          current: json.value.current,
          size: json.value.size,
          total: json.value.total,
          pages: json.value.pages,
          recordsCount: json.value.records?.length,
        });
        if (json.value.records?.length > 0) {
          console.log("[QueryData] First record keys:", Object.keys(json.value.records[0]));
        }
      }
    } catch {
      console.log("[QueryData] Response is not valid JSON");
    }
  } catch (err) {
    console.error("[QueryData] Request failed:", err instanceof Error ? err.message : err);
  }
}

main();
