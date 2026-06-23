import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 图片代理路由 —— 解决外部影像服务（CDSE/Creodias 等）的 CORS 问题。
 *
 * 用法：/api/proxy/image?url=<encodeURIComponent(imageUrl)>
 *
 * 对 CDSE 域名自动附加 Bearer Token（如果环境变量已配置）。
 */
export async function GET(request: NextRequest) {
  const urlParam = request.nextUrl.searchParams.get('url');
  if (!urlParam) {
    return NextResponse.json({ error: 'Missing "url" query parameter' }, { status: 400 });
  }

  let targetUrl: string;
  try {
    targetUrl = decodeURIComponent(urlParam);
    // eslint-disable-next-line no-new
    new URL(targetUrl); // validate
  } catch {
    return NextResponse.json({ error: 'Invalid "url" query parameter' }, { status: 400 });
  }

  // 仅允许代理图片相关 URL，防止被滥用为开放代理
  const allowedHostPatterns = [
    /datahub\.creodias\.eu/i,
    /dataspace\.copernicus\.eu/i,
    /stac\.dataspace\.copernicus\.eu/i,
    /identity\.dataspace\.copernicus\.eu/i,
    /.*\.s3\..*\.amazonaws\.com/i,
    /.*\.cloudfront\.net/i,
  ];
  const parsedUrl = new URL(targetUrl);
  const isAllowedHost = allowedHostPatterns.some((re) => re.test(parsedUrl.hostname));
  const isLocalTile =
    (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1') &&
    parsedUrl.pathname.startsWith('/local-tiles/');
  if (!isAllowedHost && !isLocalTile) {
    return NextResponse.json({ error: 'Target host not allowed' }, { status: 403 });
  }

  const headers: Record<string, string> = {
    'User-Agent': 'DataSourceIntelligence-GIS-Proxy/1.0',
  };

  // CDSE 域名需要 Bearer token
  if (/dataspace\.copernicus\.eu|creodias\.eu/i.test(new URL(targetUrl).hostname)) {
    const cdseToken = process.env.CDSE_ACCESS_TOKEN;
    if (cdseToken) {
      headers['Authorization'] = `Bearer ${cdseToken}`;
    }
  }

  try {
    const upstream = await fetch(targetUrl, { headers, redirect: 'follow' });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream error: ${upstream.status} ${upstream.statusText}` },
        { status: upstream.status }
      );
    }

    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
    const arrayBuffer = await upstream.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err) {
    console.error('[image-proxy] Fetch failed:', targetUrl, err);
    return NextResponse.json(
      { error: 'Failed to fetch image from upstream', details: String(err) },
      { status: 502 }
    );
  }
}
