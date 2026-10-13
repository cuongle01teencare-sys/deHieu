import type { Metadata } from 'next';
import { NotifyPage } from '@/components/notify/notify-page';

export const metadata: Metadata = { title: 'Thông báo' };

export default function Page() {
  return <NotifyPage />;
}
