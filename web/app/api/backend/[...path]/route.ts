import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { callBackend, isAllowedPath } from '@/lib/backend';

/**
 * BFF: trình duyệt gọi /api/backend/<path> bằng cookie phiên; server Next.js gắn token API
 * của người dùng rồi chuyển tiếp tới backend. Token không bao giờ tới trình duyệt.
 */
async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const session = await getSession();
  if (!session.username)
    return NextResponse.json({ message: 'Chưa đăng nhập' }, { status: 401 });

  // Next.js đã giải mã từng đoạn path; callBackend mã hóa lại khi gọi backend
  const path = (await ctx.params).path.join('/');
  if (!isAllowedPath(path))
    return NextResponse.json({ message: 'Không được phép' }, { status: 403 });

  let body: unknown;
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    const text = await req.text();
    body = text ? JSON.parse(text) : undefined;
  }
  try {
    const r = await callBackend(
      session.username,
      req.method,
      path,
      req.nextUrl.search,
      body,
    );
    return NextResponse.json(r.body, { status: r.status });
  } catch (e) {
    return NextResponse.json(
      { message: `Không gọi được backend: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
export const dynamic = 'force-dynamic';
