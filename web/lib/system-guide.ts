import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cache } from 'react';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';

export const readSystemGuide = cache(() =>
  readFile(path.join(process.cwd(), 'content', 'system-guide.md'), 'utf8'),
);

export async function loadSystemGuide() {
  const markdown = await readSystemGuide();
  const tree = remark().use(remarkGfm).parse(markdown);
  const headings = tree.children.flatMap((node) =>
    node.type === 'heading' && node.depth === 2 ? [node] : [],
  );
  const title = tree.children.find(
    (node) => node.type === 'heading' && node.depth === 1,
  );
  const introStart = title?.position?.end.offset ?? 0;
  const introEnd = headings[0]?.position?.start.offset ?? markdown.length;

  return {
    intro: markdown.slice(introStart, introEnd).trim(),
    sections: headings.map((heading, index) => {
      const title = heading.children
        .filter((child) => child.type === 'text' || child.type === 'inlineCode')
        .map((child) => child.value)
        .join('');
      const start = heading.position?.end.offset ?? 0;
      const end =
        headings[index + 1]?.position?.start.offset ?? markdown.length;
      return {
        id: `muc-${index + 1}`,
        title,
        markdown: markdown.slice(start, end).trim(),
      };
    }),
  };
}
