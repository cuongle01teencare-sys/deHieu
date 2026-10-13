import type { Metadata } from 'next';
import { Overview } from '@/components/overview/overview';

export const metadata: Metadata = { title: 'Tổng quan' };

export default function OverviewPage() {
  return <Overview />;
}
