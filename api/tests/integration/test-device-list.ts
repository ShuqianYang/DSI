/**
 * 设备查询接口测试
 * 地址: GET http://192.168.0.106:8082/xjzhdd/tbdevice/list?pageNum=1&pageSize=10
 *
 * 重要发现:
 * - 该接口不支持 POST, 必须使用 GET
 * - 需要 Authorization: Bearer <token> Header
 *
 * 正常响应格式（实测 2026-05-14）:
 * {
 *   "code": 200,
 *   "msg": "",
 *   "total": 76,
 *   "rows": [
 *     {
 *       "devId": "df382215358f4ca6bf58239da33a5f59",          // 设备ID
 *       "devIndexCode": "df382215358f4ca6bf58239da33a5f59",   // 设备编码
 *       "devName": "振动光纤，西围墙07-7",                      // 设备名称
 *       "devAddr": "172.168.0.158",                           // IP地址
 *       "devPort": 554,                                       // 端口
 *       "devModel": "DS-2CD3646FWDA3/F-LZS",                  // 设备型号
 *       "devUsername": "admin",                               // 用户名
 *       "devPassword": "abc12345",                            // 密码
 *       "devPicUrl": "http://...",                            // 设备图片URL
 *       "devCategory": "vss",                                 // 设备类别
 *       "devTypeCode": "encodeDevice",                        // 设备类型编码
 *       "devSerialNum": "DS-2DF8237IW-A20170418AACH748577686",// 序列号
 *       "manufacturer": "hikvision",                          // 厂商
 *       "treatyType": "hiksdk_net",                           // 协议类型
 *       "longitude": "116.273145",                            // 经度
 *       "latitude": "40.049755",                              // 纬度
 *       "elevation": "4",                                     // 海拔
 *       "installPlace": "振动光纤，摄像头",                    // 安装位置
 *       "status": -3086,                                      // 状态码
 *       "onlineStatus": 0,                                    // 在线状态 0=离线 1=在线
 *       "remoteStatus": 1,                                    // 远程状态
 *       "createTime": "2026-01-13 17:18:11",                  // 创建时间
 *       "updateTime": "2026-05-14 11:34:46",                  // 更新时间
 *       "devCapability": "{event_face_detect_alarm,event_audio,motiontrack,...}", // 能力集
 *       "extendedAttribute": "{...}",                         // 扩展属性(JSON字符串)
 *       "isMockData": 1,                                      // 是否模拟数据
 *       "dataSourceType": 1,                                  // 数据源类型
 *       "regionPath": "@root00000000@",                       // 区域路径
 *       ... // 还有其他约60+个字段
 *     }
 *   ]
 * }
 *
 * 核心字段（地图展示常用）:
 * - devId / devIndexCode: 唯一标识
 * - devName: 显示名称
 * - longitude / latitude: GPS坐标(字符串格式, 需 parseFloat)
 * - devPicUrl: 设备图片
 * - onlineStatus: 0=离线, 1=在线
 * - status: 设备状态码
 * - installPlace: 安装位置描述
 *
 * 错误响应（实测 POST 时返回）:
 * { "msg": "Request method 'POST' not supported", "code": 500 }
 */

const BASE_URL = "http://192.168.0.106:8082/xjzhdd/tbdevice/list";

async function main() {
  const url = `${BASE_URL}?pageNum=1&pageSize=10`;
  console.log(`[Device] GET ${url}`);

  const start = Date.now();
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJhZG1pbiIsImxvZ2luX3VzZXJfa2V5IjoiNzA5MTkyYTQtYjk3ZC00NzliLTk1NWEtYWMwYWUxNDg4ZmI0In0.0BYq9L8CtsQvbwd-tx7v1yKnp7V1VJDNkLBNG-5SOQ4a2iQWbhyx8K_K9t-eFR8LhAlbR11TAaXVwwinDdUEzA",
      },
    });

    const elapsed = Date.now() - start;
    console.log(`[Device] Status: ${resp.status} ${resp.statusText} (${elapsed}ms)`);

    const body = await resp.text();
    console.log("[Device] Raw response:\n", body.slice(0, 3000));

    try {
      const json = JSON.parse(body);
      console.log("\n[Device] Parsed JSON keys:", Object.keys(json));

      if (json.rows && Array.isArray(json.rows)) {
        console.log(`[Device] Total: ${json.total ?? "N/A"}, Rows: ${json.rows.length}`);
        if (json.rows.length > 0) {
          console.log(`[Device] First row keys:`, Object.keys(json.rows[0]));
        }
      }
      if (json.data && Array.isArray(json.data)) {
        console.log(`[Device] Total: ${json.total ?? "N/A"}, Data: ${json.data.length}`);
        if (json.data.length > 0) {
          console.log(`[Device] First item keys:`, Object.keys(json.data[0]));
        }
      }
    } catch {
      console.log("[Device] Response is not valid JSON");
    }
  } catch (err) {
    console.error("[Device] Request failed:", err instanceof Error ? err.message : err);
  }
}

main();
