import type { Metadata } from 'next';
import { TradingPage } from '@/components/trading/trading-page';

export const metadata: Metadata = { title: 'Auto trade' };

export default function Page() {
  return <TradingPage />;
}
