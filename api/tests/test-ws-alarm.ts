/**
 * WebSocket 预警数据接口测试
 * 地址: ws://192.168.0.106:8082/ws/global
 *
 * 实际返回消息格式（已验证 2026-05-14）：
 * {
 *   "type": "devicePTZPos",           // 消息类型: devicePTZPos(云台位置), 也可能有 alarmEvent(预警事件)
 *   "data": [
 *     {
 *       "devId": "df382215358f4ca6bf58239da3311111",
 *       "result": {
 *         "wZoomPos_10": 1,             // 变倍位置(0.1度)
 *         "wPanPos_10": 155,            // 水平位置(0.1度)
 *         "wTiltPos": 32,               // 垂直位置(原始值)
 *         "wPanPos": 5456,              // 水平位置(原始值)
 *         "wZoomPos": 16,               // 变倍位置(原始值)
 *         "wTiltPos_10": 2              // 垂直位置(0.1度)
 *       }
 *     }
 *   ]
 * }
 *
 * 说明:
 * - 当前测试未收到 alarmEvent 类型消息, 持续收到的是 devicePTZPos(云台位置推送)
 * - alarmEvent 可能在有预警触发时才会推送
 * - 消息频率: 约每秒 2~4 条(devicePTZPos 持续推送)
 */

import WebSocket from "ws";

const WS_URL = "ws://192.168.0.106:8082/ws/global";
const TIMEOUT_MS = 30_000;

async function main() {
  console.log(`[WS Alarm] Connecting to ${WS_URL}...`);

  const ws = new WebSocket(WS_URL);
  let msgCount = 0;
  let alarmCount = 0;
  let timer: NodeJS.Timeout | null = null;

  ws.on("open", () => {
    console.log("[WS Alarm] Connected successfully");
    console.log("[WS Alarm] Waiting for messages... (timeout: 30s)\n");

    timer = setTimeout(() => {
      console.log(`\n[WS Alarm] Timeout reached (${TIMEOUT_MS}ms). Closing connection...`);
      console.log(`[WS Alarm] Total messages: ${msgCount}, alarmEvent: ${alarmCount}`);
      ws.close();
    }, TIMEOUT_MS);
  });

  ws.on("message", (data) => {
    msgCount++;
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "alarmEvent" && msg.alarmEvent) {
        alarmCount++;
        console.log(`\n[WS Alarm] alarmEvent #${alarmCount}:`);
        console.log(JSON.stringify(msg.alarmEvent, null, 2));
      } else if (msgCount <= 3) {
        // 只打印前 3 条非 alarm 消息用于观察格式
        console.log(`[WS Alarm] Msg #${msgCount} type="${msg.type}" keys=[${Object.keys(msg).join(", ")}]`);
      }
    } catch {
      console.log(`[WS Alarm] Msg #${msgCount} (non-JSON):`, data.toString().slice(0, 200));
    }
  });

  ws.on("error", (err) => {
    console.error("[WS Alarm] Connection error:", err.message);
    if (timer) clearTimeout(timer);
    process.exit(1);
  });

  ws.on("close", (code, reason) => {
    console.log(`\n[WS Alarm] Closed. Code=${code}, Reason=${reason || "none"}`);
    console.log(`[WS Alarm] Summary: total=${msgCount}, alarmEvent=${alarmCount}`);
    if (timer) clearTimeout(timer);
    process.exit(0);
  });
}

main();
