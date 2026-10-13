import type { Metadata } from 'next';
import { MatchesPage } from '@/components/matches/matches-page';

export const metadata: Metadata = { title: 'Trận đấu' };

export default function Page() {
  return <MatchesPage />;
}
