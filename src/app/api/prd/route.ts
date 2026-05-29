import { NextRequest, NextResponse } from 'next/server';

// 顶层 import coze-coding-dev-sdk 在 next build 的 page data collection 阶段会触发 `class extends undefined`；改成 handler 内 lazy import + force-dynamic 让 build 不预加载该 SDK
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PRD_URL = 'https://coze-coding-project.tos.coze.site/create_attachment/2026-04-17/494131808305162_77e7085b732b2eb56ec11e1e288bc583_%E6%95%B0%E6%99%BA%E8%9E%8D%E5%90%88%E6%99%BA%E8%83%BD%E4%BD%93%E5%BA%94%E7%94%A8%E4%BA%A7%E5%93%81%E9%9C%80%E6%B1%82%E6%96%87%E6%A1%A3%EF%BC%88PRD%EF%BC%89.docx?sign=4898474520-618fa07028-0-13a129700bd5cba9f0f3b74c589255ef34806292ab582106e43d46e81c78e6b6';

export async function GET(request: NextRequest) {
  try {
    const { FetchClient, Config, HeaderUtils } = await import('coze-coding-dev-sdk');
    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new FetchClient(config, customHeaders);

    const response = await client.fetch(PRD_URL);

    if (response.status_code !== 0) {
      return NextResponse.json(
        { error: 'Failed to fetch PRD document', details: response.status_message },
        { status: 500 }
      );
    }

    // Extract text content from the document
    const textContent = response.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join('\n');

    return NextResponse.json({
      title: response.title,
      content: textContent,
      rawContent: response.content,
      url: response.url,
    });
  } catch (error) {
    console.error('Error fetching PRD:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}
