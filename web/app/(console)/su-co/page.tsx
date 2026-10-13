import type { Metadata } from 'next';
import { IncidentsPage } from '@/components/incidents/incidents-page';

export const metadata: Metadata = { title: 'Sự cố' };

export default function Page() {
  return <IncidentsPage />;
}
