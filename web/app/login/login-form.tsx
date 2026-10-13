'use client';

import { useActionState } from 'react';
import { AlertCircle } from 'lucide-react';
import { login, type LoginState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/controls';
import { Wordmark } from '@/components/shell/wordmark';

/** Đăng nhập tối giản: wordmark, tên đăng nhập, mật khẩu, một nút. */
export function LoginForm({ mockHint }: { mockHint: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, { error: null, username: '' });
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 pb-safe pt-safe">
      <form action={action} className="flex w-full max-w-[320px] flex-col animate-fade-in">
        <Wordmark className="mb-12 self-center [&_svg]:size-8 [&>span]:text-[17px]" />
        <label className="mb-4 flex flex-col gap-2 text-body font-medium text-fg">
          Tên đăng nhập
          <Input name="username" autoComplete="username" defaultValue={state.username} autoFocus={!state.username} required className="h-11 text-[15px] md:h-10" autoCapitalize="none" />
        </label>
        <label className="mb-6 flex flex-col gap-2 text-body font-medium text-fg">
          Mật khẩu
          <Input name="password" type="password" autoComplete="current-password" autoFocus={!!state.username} required className="h-11 text-[15px] md:h-10" />
        </label>
        {state.error ? (
          <p role="alert" className="-mt-2 mb-5 flex items-center gap-2 text-caption text-critical">
            <AlertCircle className="size-3.5" /> {state.error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" loading={pending} className="h-11 md:h-10">
          {pending ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </Button>
        {mockHint ? <p className="mt-6 text-center text-caption text-faint">Dữ liệu mẫu: demo / demo</p> : null}
      </form>
    </main>
  );
}
