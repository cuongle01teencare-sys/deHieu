import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { config } from '@/lib/config';
import { LoginForm } from './login-form';
import { safeNext } from './actions';

export const metadata: Metadata = { title: 'Đăng nhập' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  // ?next= : đăng nhập xong quay lại trang đó (vd link bật thông báo gửi sang điện thoại khác)
  const next = await safeNext((await searchParams).next);
  if (await currentUser()) redirect(next);
  return <LoginForm mockHint={config.mock && !process.env.WEB_USERS?.trim()} next={next} />;
}
