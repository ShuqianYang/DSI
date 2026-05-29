import { NextRequest, NextResponse } from 'next/server';

// 顶层 import coze-coding-dev-sdk 在 next build 的 page data collection 阶段会触发 `class extends undefined`；改成 handler 内 lazy import + force-dynamic 让 build 不预加载该 SDK
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 数智融合智能体的系统提示词
const SYSTEM_PROMPT = `你是「数智融合智能体」，一个专业的情报分析助手。你的职责是：

1. **海域态势分析**：分析船舶航行轨迹、识别异常行为、评估风险等级
2. **情报问答**：基于开源情报回答用户关于地缘政治、军事动态、行业风险等问题
3. **任务管理**：帮助用户创建和管理订阅任务、定时推送报告
4. **GIS联动**：当回答涉及空间数据时，应提示是否需要联动地球引擎展示

**回答风格**：
- 简洁专业，使用结构化格式（列表、表格）
- 涉及关键数据时使用中文标注（如：高危、警告、正常）
- 如需展示空间数据，明确说明包含GIS联动信息

**当前数据环境**：
- 可访问东海海域的船舶、飞机、基站等实体数据
- 支持轨迹追踪、区域管控、告警监测
- 可生成态势分析报告`;

export async function POST(request: NextRequest) {
  try {
    const { LLMClient, Config, HeaderUtils } = await import('coze-coding-dev-sdk');
    const { messages } = await request.json();
    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new LLMClient(config, customHeaders);

    // 构建完整消息列表
    const fullMessages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      ...messages,
    ];

    // 使用流式响应
    const stream = client.stream(fullMessages, {
      model: 'doubao-seed-2-0-pro-260215',
      temperature: 0.7,
    });

    // 创建流式响应
    const encoder = new TextEncoder();
    const streamResponse = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            if (chunk.content) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ content: chunk.content })}\n\n`)
              );
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch (error) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: String(error) })}\n\n`)
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(streamResponse, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('LLM API Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}

// GET 请求返回API信息
export async function GET() {
  return NextResponse.json({
    name: '数智融合智能体问答API',
    version: '1.0',
    description: '基于大语言模型的智能问答服务，支持流式输出',
    endpoints: {
      POST: {
        method: 'POST',
        path: '/api/chat',
        description: '发送消息并获取AI回复（流式）',
        body: {
          messages: 'Array<{ role: "user" | "assistant", content: string }>',
        },
      },
    },
    features: [
      '海域态势分析',
      '开源情报问答',
      '任务订阅管理',
      'GIS空间数据联动',
    ],
  });
}
