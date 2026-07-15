const badJson = `"goal": "分析东海近期海域安全态势", "steps": [ { "id": "step-1", description": "明确分析时间范围", "purpose": "确定时间跨度", "expectedOutput": "时间范围" }, { "id": "step-2", "description": "检索数据", "purpose": "获取数据", "expectedOutput": "数据" } ], "reasoning": "用户请求分析海域态势。"`;

let wrapped = badJson;
if (!badJson.startsWith("{")) {
  wrapped = badJson.endsWith("}") ? `{${badJson}` : `{${badJson}}`;
}
console.log("wrapped:", wrapped);
console.log("");

const fixedQuotes = wrapped.replace(/([{\[,]\s*)([a-zA-Z_]\w*)\s*"\s*:/g, '$1"$2":');
console.log("fixed:", fixedQuotes);
console.log("");

try {
  JSON.parse(fixedQuotes);
  console.log("OK");
} catch (e) {
  console.log("FAIL:", (e as Error).message);
}
