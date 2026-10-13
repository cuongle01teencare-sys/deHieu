import type { Metadata } from 'next';
import { DesignPage } from '@/components/design/design-page';

export const metadata: Metadata = { title: 'Hệ thống thiết kế' };

export default function Page() {
  return <DesignPage />;
}
