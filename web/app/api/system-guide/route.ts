import { currentUser } from '@/lib/session';
import { readSystemGuide } from '@/lib/system-guide';

export async function GET() {
  if (!(await currentUser()))
    return new Response('Unauthorized', { status: 401 });
  return new Response(await readSystemGuide(), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': 'attachment; filename="system-guide.md"',
      'Cache-Control': 'private, no-store',
    },
  });
}
