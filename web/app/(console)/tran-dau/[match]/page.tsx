import type { Metadata } from 'next';
import { MatchDetailPage } from '@/components/matches/match-detail';

export async function generateMetadata({ params }: { params: Promise<{ match: string }> }): Promise<Metadata> {
  const id = decodeURIComponent((await params).match);
  return { title: id.split(':')[1]?.replace('~', ' vs ') ?? id };
}

export default async function Page({ params }: { params: Promise<{ match: string }> }) {
  return <MatchDetailPage id={decodeURIComponent((await params).match)} />;
}
