import type { Metadata } from 'next';
import { OneClickPage } from '@/components/trading/one-click-page';

export const metadata: Metadata = { title: 'On click' };

export default function Page() {
  return <OneClickPage />;
}
