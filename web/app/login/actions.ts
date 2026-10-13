'use server';

import { redirect } from 'next/navigation';
import { authenticate } from '@/lib/users';
import { getSession } from '@/lib/session';

export interface LoginState {
  error: string | null;
  /** Giữ lại tên đăng nhập: React 19 tự xóa form sau mỗi lần action chạy xong. */
  username: string;
}

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const username = String(form.get('username') ?? '').trim();
  const password = String(form.get('password') ?? '');
  if (!username || !password) return { error: 'Nhập tên đăng nhập và mật khẩu.', username };
  const user = authenticate(username, password);
  if (!user) return { error: 'Sai tên đăng nhập hoặc mật khẩu.', username };
  const session = await getSession();
  session.username = user.username;
  await session.save();
  redirect('/');
}

export async function logout(): Promise<void> {
  const session = await getSession();
  session.destroy();
  redirect('/login');
}
