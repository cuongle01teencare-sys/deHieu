import type { Metadata } from 'next';
import { PublisherPage } from '@/components/publisher/publisher-page';

export const metadata: Metadata = { title: 'Publisher & Node' };

export default function Page() {
  return <PublisherPage />;
}
