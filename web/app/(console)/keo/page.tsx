import type { Metadata } from 'next';
import { SignalsPage } from '@/components/signals/signals-page';

export const metadata: Metadata = { title: 'Kèo' };

export default function Page() {
  return <SignalsPage />;
}
