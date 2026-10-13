import type { Metadata } from 'next';
import { OddsHistoryPage } from '@/components/audit/audit-page';

export const metadata: Metadata = { title: 'Lịch sử odds' };

export default function Page() {
  return <OddsHistoryPage />;
}
