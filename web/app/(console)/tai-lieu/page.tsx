import type { Metadata } from 'next';
import Link from 'next/link';
import { Download, Waypoints } from 'lucide-react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { GuideReader } from '@/components/docs/guide-reader';
import styles from '@/components/docs/system-guide.module.css';
import { PageHeader } from '@/components/ui/layout';
import { loadSystemGuide } from '@/lib/system-guide';

export const metadata: Metadata = { title: 'Tài liệu hệ thống' };

const components: Components = {
  table: ({ children }) => (
    <div className={styles.table}>
      <table>{children}</table>
    </div>
  ),
  pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
  a: ({ href, children }) =>
    href?.startsWith('/') ? (
      <Link href={href}>{children}</Link>
    ) : (
      <a href={href}>{children}</a>
    ),
};

export default async function Page() {
  const guide = await loadSystemGuide();
  return (
    <>
      <PageHeader
        title="Tài liệu hệ thống"
        description="Từ một con số odds đến một cơ hội arbitrage."
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/ingest"
              className="inline-flex h-8 items-center gap-2 rounded-[6px] px-2.5 text-caption text-muted-fg hover:bg-hover hover:text-fg"
            >
              <Waypoints className="size-4" /> Luồng dữ liệu
            </Link>
            <a
              href="/api/system-guide"
              download="system-guide.md"
              title="Tải tài liệu Markdown"
              aria-label="Tải tài liệu Markdown"
              className="grid size-8 place-items-center rounded-[6px] text-muted-fg hover:bg-hover hover:text-fg"
            >
              <Download className="size-4" />
            </a>
          </div>
        }
      />
      <GuideReader
        intro={
          <Markdown remarkPlugins={[remarkGfm]} components={components}>
            {guide.intro}
          </Markdown>
        }
        sections={guide.sections.map((section) => ({
          id: section.id,
          title: section.title,
          searchText: `${section.title}\n${section.markdown}`,
          content: (
            <Markdown remarkPlugins={[remarkGfm]} components={components}>
              {section.markdown}
            </Markdown>
          ),
        }))}
      />
    </>
  );
}
