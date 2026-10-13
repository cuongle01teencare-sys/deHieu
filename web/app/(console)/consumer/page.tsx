import type { Metadata } from 'next';
import { ConsumersPage } from '@/components/consumers/consumers-page';

export const metadata: Metadata = { title: 'Consumer' };

export default function Page() {
  return <ConsumersPage />;
}
