import type { Metadata } from 'next';
import { IngestPage } from '@/components/ingest/ingest-page';

export const metadata: Metadata = { title: 'Luồng dữ liệu' };

export default function Page() {
  return <IngestPage />;
}
