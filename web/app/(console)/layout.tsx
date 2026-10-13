import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { config } from '@/lib/config';
import { AppShell } from '@/components/shell/app-shell';
import { BootScreen } from '@/components/shell/boot-screen';

/** Mọi màn hình console cần đăng nhập. */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  return (
    <Suspense fallback={<BootScreen />}>
      <AppShell user={user} envLabel={config.mock ? 'Dữ liệu mẫu' : config.envLabel}>
        {children}
      </AppShell>
    </Suspense>
  );
}
