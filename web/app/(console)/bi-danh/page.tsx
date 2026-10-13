import type { Metadata } from 'next';
import { AliasesPage } from '@/components/settings/settings-page';

export const metadata: Metadata = { title: 'Bí danh đội' };

export default function Page() {
  return <AliasesPage />;
}
