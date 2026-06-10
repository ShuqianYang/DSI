// 临时测试脚本：直接调用天基 queryData 接口，测试地震/洪水历史影像查询

const TEST_CASES = [
  {
    name: "地震前历史影像",
    body: {
      pageNo: 1,
      pageSize: 10,
      satelliteName: "高分五号A星",
      payloadType: ["可见光"],
      productType: "目标切片",
      dataType: "地震前",
      targetType: "地震前",
      reqObj: "天元认知计算",
      reqContent: "接收到天元认知计算系统的历史影像查询(地震)需求，完成影像检索并反馈",
    },
  },
  {
    name: "洪水前历史影像",
    body: {
      pageNo: 1,
      pageSize: 10,
      satelliteName: "高分五号A星",
      payloadType: ["可见光"],
      productType: "目标切片",
      dataType: "洪水前",
      targetType: "洪水前",
      reqObj: "天元认知计算",
      reqContent: "接收到天元认知计算系统的历史影像查询(洪水)需求，完成影像检索并反馈",
    },
  },
  {
    name: "油膜历史影像（对照组）",
    body: {
      pageNo: 1,
      pageSize: 10,
      satelliteName: "高分五号A星",
      payloadType: ["红外"],
      productType: "目标切片",
      dataType: "漏油",
      targetType: "漏油",
      reqObj: "天元认知计算",
      reqContent: "接收到天元认知计算系统的历史影像查询(油膜)需求，完成影像检索并反馈",
    },
  },
];

async function testQuery(name, body) {
  console.log(`\n========== ${name} ==========`);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const resp = await fetch("http://192.168.0.129:5000/agent/queryData", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    console.log(`HTTP 状态: ${resp.status} ${resp.statusText}`);

    if (!resp.ok) {
      console.log("请求失败");
      return;
    }

    const json = await resp.json();
    console.log(`响应 state: ${json.state}`);
    console.log(`records 数量: ${json.value?.records?.length ?? 0}`);

    if (json.value?.records?.length > 0) {
      const first = json.value.records[0];
      console.log(`第一条 previewUrl: ${first.previewUrl || "无"}`);
      console.log(`第一条完整数据:`);
      console.log(JSON.stringify(first, null, 2));
    } else {
      console.log("无数据返回");
    }
  } catch (err) {
    console.error("异常:", err.message);
  }
}

(async () => {
  for (const tc of TEST_CASES) {
    await testQuery(tc.name, tc.body);
  }
  console.log("\n========== 测试完成 ==========");
})();
