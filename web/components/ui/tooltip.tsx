'use client';

import type { ReactNode } from 'react';
import { Popover, Tooltip } from 'radix-ui';
import { useNoHover } from '@/hooks/use-media';
import { cn } from '@/lib/utils';

const contentCls =
  'z-50 max-w-72 rounded-[6px] bg-raised px-2.5 py-1.5 text-caption text-fg shadow-pop animate-fade-in';

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={100}>
      {children}
    </Tooltip.Provider>
  );
}

/**
 * Gợi ý nhỏ: hover trên desktop; trên thiết bị cảm ứng chuyển thành chạm để xem
 * (không để thông tin chỉ hiện khi hover).
 */
export function Hint({
  content,
  children,
  side = 'top',
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}) {
  const touch = useNoHover();
  if (!content) return <>{children}</>;
  if (touch)
    return (
      <Popover.Root>
        <Popover.Trigger asChild>{children}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content side={side} sideOffset={6} className={cn(contentCls, className)}>
            {content}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={side} sideOffset={6} className={cn(contentCls, className)}>
          {content}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
