import type { Metadata } from 'next';
import { CandidatesPage } from '@/components/candidates/candidates-page';

export const metadata: Metadata = { title: 'Ghép trượt' };

export default function Page() {
  return <CandidatesPage />;
}
