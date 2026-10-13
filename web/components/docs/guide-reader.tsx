'use client';

import { useState, type ReactNode } from 'react';
import { BookOpen, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/controls';
import styles from './system-guide.module.css';

interface GuideSection {
  id: string;
  title: string;
  searchText: string;
  content: ReactNode;
}

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

export function GuideReader({
  sections,
  intro,
}: {
  sections: GuideSection[];
  intro: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const needle = normalize(query.trim());
  const visible = sections.filter(
    (section) => !needle || normalize(section.searchText).includes(needle),
  );

  return (
    <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_224px] lg:gap-12">
      <div className="min-w-0">
        <div className="mb-7 flex flex-wrap items-center gap-3 border-b border-line pb-5">
          <div className="relative w-full max-w-md">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
            />
            <Input
              type="search"
              aria-label="Tìm trong tài liệu"
              placeholder="Tìm thuật ngữ, bản tin, room..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-10 pl-9 pr-9"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Xóa tìm kiếm"
                title="Xóa tìm kiếm"
                className="absolute right-1 top-1 grid size-8 place-items-center rounded-[6px] text-faint hover:bg-hover hover:text-fg"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
          <span role="status" className="text-caption text-muted-fg">
            {needle
              ? `${visible.length} / ${sections.length} mục`
              : `${sections.length} mục`}
          </span>
        </div>

        <nav
          aria-label="Mục lục tài liệu"
          className="mb-8 border-b border-line pb-5 lg:hidden"
        >
          <details>
            <summary className="cursor-pointer text-body font-medium">
              Mục lục
            </summary>
            <ol className="mt-3 flex flex-col gap-2">
              {visible.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="text-body text-muted-fg hover:text-accent-text"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </details>
        </nav>

        {!needle ? (
          <div className={`${styles.article} mb-8 max-w-3xl text-muted-fg`}>
            {intro}
          </div>
        ) : null}
        {visible.length ? (
          visible.map((section) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-title`}
              className={`${styles.section} min-w-0 border-b border-line pb-8 pt-2 last:border-0`}
            >
              <h2
                id={`${section.id}-title`}
                className="mb-4 text-[20px] font-semibold leading-snug text-fg"
              >
                {section.title}
              </h2>
              <div className={styles.article}>{section.content}</div>
            </section>
          ))
        ) : (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
            <BookOpen aria-hidden className="size-6 text-faint" />
            <p className="text-body text-muted-fg">
              Không tìm thấy mục phù hợp.
            </p>
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-body text-accent-text hover:underline"
            >
              Xóa tìm kiếm
            </button>
          </div>
        )}
      </div>

      <aside className="hidden min-w-0 lg:block">
        <nav
          aria-label="Mục lục tài liệu"
          className="sticky top-20 max-h-[calc(100dvh-112px)] overflow-y-auto border-l border-line pl-5"
        >
          <div className="mb-4 flex items-center gap-2 text-caption font-medium text-fg">
            <BookOpen aria-hidden className="size-4 text-muted-fg" /> Mục lục
          </div>
          <ol className="flex flex-col gap-3">
            {visible.map((section, index) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="flex gap-2 text-caption leading-relaxed text-muted-fg hover:text-accent-text"
                >
                  <span className="num w-4 shrink-0 text-faint">
                    {index + 1}
                  </span>
                  <span>{section.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </aside>
    </div>
  );
}
