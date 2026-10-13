import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { config } from '@/lib/config';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Đăng nhập' };

export default async function LoginPage() {
  if (await currentUser()) redirect('/');
  return <LoginForm mockHint={config.mock && !process.env.WEB_USERS?.trim()} />;
}
