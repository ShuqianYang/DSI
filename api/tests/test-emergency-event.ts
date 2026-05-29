/**
 * 情报接口测试（翠花系统对接）
 * 地址: POST http://192.168.0.106:8082/system/emergencyEvent/receiveDataInfo
 *
 * 请求参数（Content-Type: application/json）:
 * {
 *   "id": "GF3_20260410_000124_id1",           // 情报唯一ID
 *   "satellite": "GF-3",                        // 卫星名称
 *   "sensor": "SAR",                            // 传感器类型
 *   "acquisition_time": "2026-04-10T10:23:45",  // 采集时间(ISO8601)
 *   "resolution": 1.0,                          // 分辨率(米)
 *   "source_image_id": "GF3_20260410_000123",   // 源影像ID
 *   "center_longitude": 121.4737,               // 中心经度
 *   "center_latitude": 31.2304,                 // 中心纬度
 *   "target_type": "水情",                       // 目标类型
 *   "confidence": 0.98,                         // 置信度(0-1)
 *   "width": 256,                               // 图像宽度(像素)
 *   "height": 256,                              // 图像高度(像素)
 *   "url": "http://...",                        // 图像URL
 *   "address": "未名视通研发楼3333"              // 地址描述
 * }
 *
 * 响应格式（实测 2026-05-14）:
 * {
 *   "msg": "应急数据同步成功",
 *   "code": 200
 * }
 */

const URL = "http://192.168.0.106:8085/system/emergencyEvent/receiveDataInfo";

const payload = {
  id: "GF3_20260410_000124_id1",
  satellite: "GF-3",
  sensor: "SAR",
  acquisition_time: "2026-04-10T10:23:45",
  resolution: 1.0,
  source_image_id: "GF3_20260410_000123",
  center_longitude: 121.4737,
  center_latitude: 31.2304,
  target_type: "水情",
  confidence: 0.98,
  width: 256,
  height: 256,
  url: "http://192.168.0.105:9000/bucket-vehicle-capture/20260320/20260321074640_e0cd6893fc46444eadd59171c2ad2b7c.jpg",
  address: "未名视通研发楼3333",
};

async function main() {
  console.log(`[Emergency] POST ${URL}`);
  console.log("[Emergency] Payload:", JSON.stringify(payload, null, 2));

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
    console.log(`\n[Emergency] Status: ${resp.status} ${resp.statusText} (${elapsed}ms)`);

    const body = await resp.text();
    console.log("[Emergency] Raw response:\n", body);

    try {
      const json = JSON.parse(body);
      console.log("[Emergency] Parsed keys:", Object.keys(json));
    } catch {
      console.log("[Emergency] Response is not valid JSON");
    }
  } catch (err) {
    console.error("[Emergency] Request failed:", err instanceof Error ? err.message : err);
  }
}

main();
