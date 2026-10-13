'use client';

import type { ReactNode } from 'react';
import { DropdownMenu, Popover as RPopover } from 'radix-ui';
import { cn } from '@/lib/utils';
import { Hint } from './tooltip';

const pop = 'z-50 min-w-44 rounded-[8px] bg-raised p-1 shadow-pop outline-none animate-pop-in';

export function Menu({
  trigger,
  children,
  align = 'end',
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'end' | 'center';
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align={align} sideOffset={6} className={pop}>
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem({
  children,
  onSelect,
  icon,
  danger,
  disabledReason,
}: {
  children: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  danger?: boolean;
  /** Mục bị khóa kèm lý do (vd thiếu quyền). */
  disabledReason?: string | null;
}) {
  const item = (
    <DropdownMenu.Item
      disabled={!!disabledReason}
      onSelect={onSelect}
      className={cn(
        'flex h-8 cursor-pointer select-none items-center gap-2.5 rounded-[5px] px-2 text-body outline-none transition-colors',
        'data-[highlighted]:bg-hover data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45',
        '[&_svg]:size-4 [&_svg]:stroke-[1.5]',
        danger ? 'text-critical' : 'text-fg [&_svg]:text-muted-fg',
      )}
    >
      {icon}
      <span className="flex-1">{children}</span>
    </DropdownMenu.Item>
  );
  return disabledReason ? (
    <Hint content={disabledReason} side="left">
      <div>{item}</div>
    </Hint>
  ) : (
    item
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-line" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="px-2 pb-1 pt-1.5 text-micro text-faint">{children}</DropdownMenu.Label>;
}

export function Popover({
  trigger,
  children,
  align = 'start',
  className,
  open,
  onOpenChange,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'end' | 'center';
  className?: string;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content align={align} sideOffset={8} className={cn(pop, 'p-4', className)}>
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}
