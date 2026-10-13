import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { callBackend } from '@/lib/backend';
import { config } from '@/lib/config';

/**
 * Trình duyệt xin vé mở stream admin. Server xin vé một lần (60s) từ backend bằng token
 * của người dùng; trình duyệt chỉ nhận vé + URL wss. Không có URL stream / chế độ mẫu → polling.
 */
export async function POST() {
  const session = await getSession();
  if (!session.username)
    return NextResponse.json({ message: 'Chưa đăng nhập' }, { status: 401 });
  if (config.mock || !config.adminWsUrl)
    return NextResponse.json({ mode: 'polling' as const });
  const r = await callBackend(session.username, 'POST', 'admin/ws-ticket');
  if (r.status >= 300) return NextResponse.json(r.body, { status: r.status });
  const { ticket } = r.body as { ticket: string };
  return NextResponse.json({ mode: 'stream' as const, ticket, url: config.adminWsUrl });
}

export const dynamic = 'force-dynamic';
