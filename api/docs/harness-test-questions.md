# Harness 前端测试问题集

> 覆盖所有路由路径，方便在前端快速验证 Agent Harness 行为

---

## 一、Skill 命中（零 LLM，直接执行）

| # | 问题 | 预期路径 | 验证点 |
|---|------|---------|--------|
| W1 | "东京今天天气怎么样" | `weather.fetch` | 零 LLM，location=东京 |
| W2 | "北京明天会下雨吗" | `weather.fetch` | 参数 date=tomorrow |
| W3 | "大阪现在气温多少" | `weather.fetch` | 单关键词命中 |
| W4 | "上海后天天气预报" | `weather.fetch` | 参数 date=day_after_tomorrow |

---

## 二、Template 命中（零 LLM，多步执行）

| # | 问题 | 预期路径 | 验证点 |
|---|------|---------|--------|
| N1 | "最近日本有什么灾害新闻" | `news.search → finalizer` | 两步执行，Step 2 读取 Step 1 结果 |
| N2 | "帮我搜一下最近的舆情报道" | `news.search → finalizer` | 关键词命中 template |
| N3 | "最近有什么热点事件" | `news.search → finalizer` | 单关键词命中 |
| N4 | "查一下最近的国际新闻动态" | `news.search → finalizer` | 多关键词匹配 |

---

## 三、System Tool（Agent Loop，本地执行）

| # | 问题 | 预期路径 | 验证点 |
|---|------|---------|--------|
| T1 | "现在几点了" | `time.now` | 返回当前时间+时区 |
| T2 | "纽约现在什么时间" | `time.now` | 参数 timezone=America/New_York |
| C1 | "3.5 的平方加 16 的平方根是多少" | `calc.evaluate` | 结果 28.25 |
| C2 | "100 公里每小时等于多少米每秒" | `calc.evaluate` | 结果 ≈27.78 |
| C3 | "圆周率乘以 2 的平方是多少" | `calc.evaluate` | π×4 ≈ 12.57 |

---

## 四、Agent Loop 多步推理（LLM 驱动）

| # | 问题 | 预期路径 | 验证点 |
|---|------|---------|--------|
| A1 | "帮我看看 https://httpbin.org/html 这个网页说了什么" | `web.fetch → final_answer` | LLM 识别 URL、抓取、总结 |
| A2 | "最近日本有没有灾害，会不会影响我下周去东京出差" | `news.search → final_answer` | LLM 综合判断出行建议 |
| A3 | "现在几点了，顺便帮我算一下 2 的 10 次方是多少" | `time.now → calc.evaluate → final_answer` | 多工具链 |

---

## 五、LLM 直接回答（无需工具）

| # | 问题 | 预期路径 | 验证点 |
|---|------|---------|--------|
| D1 | "你好，你能做什么" | `final_answer` | LLM 自我介绍，无工具调用 |
| D2 | "1+1 等于几" | `final_answer` 或 `calc.evaluate` | 观察 LLM 是否调用计算器 |
| D3 | "什么是人工智能" | `final_answer` | 纯知识问答 |
| D4 | "讲个笑话" | `final_answer` | 纯生成任务 |

---

## 六、Legacy Fallback（回退旧 Pipeline）

| # | 问题 | 预期路径 | 验证点 |
|---|------|---------|--------|
| L1 | "查询东海海域态势" | `legacy_fallback → maritime` | 复杂查询拦截，回退旧 Pipeline |
| L2 | "分析一下南海当前船舶分布情况" | `legacy_fallback → maritime` | 海域态势分析 |
| L3 | "帮我看看最近有没有异常的 AIS 轨迹" | `legacy_fallback → maritime/ais-fetch` | 多步骤旧 Pipeline |

---

## 七、边界/压力测试

| # | 问题 | 预期路径 | 验证点 |
|---|------|---------|--------|
| B1 | "先查日本新闻，再查东京天气，最后算一下风速 10m/s 是多少 km/h" | `news/weather/calc` | 多工具链，观察是否被 skill 拦截 |
| B2 | "https://example.com/article"（无效 URL） | `web.fetch → failed` | 错误处理 |
| B3 | "查询火星上的天气" | `final_answer` | 无可用工具，fallback 到直接回答 |
| B4 | ""（空输入） | `final_answer` | 空 query 处理 |
| B5 | "天气新闻时间计算" | `weather.fetch` 或 `news.search` | 多个 skill 竞争，观察命中哪个 |

---

## 八、快速验证清单

前端测试时按以下顺序验证，5 分钟覆盖全部路径：

```
1. "现在几点了"              → 验证 System Tool (time.now)
2. "1+1 等于几"              → 验证 LLM 直接回答 / calc
3. "东京今天天气怎么样"       → 验证 Skill 命中 (weather)
4. "最近日本有什么灾害新闻"   → 验证 Template 命中 (news)
5. "帮我看看 https://httpbin.org/html" → 验证 Agent Loop (web.fetch)
6. "查询东海海域态势"         → 验证 Legacy Fallback
```
