import type { Metadata } from 'next';
import { MatchDetailPage } from '@/components/matches/match-detail';
import { decodePathSegment } from '@/lib/match-links';

export async function generateMetadata({ params }: { params: Promise<{ match: string }> }): Promise<Metadata> {
  const id = decodePathSegment((await params).match);
  return { title: id.split(':')[1]?.replace('~', ' vs ') ?? id };
}

export default async function Page({ params }: { params: Promise<{ match: string }> }) {
  const id = decodePathSegment((await params).match);
  return <MatchDetailPage key={id} id={id} />;
}
