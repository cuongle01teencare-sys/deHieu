'use client';

import { Crosshair, Gamepad2, Swords } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtStamp, fmtStarts } from '@/lib/format';
import { SPORT_LABEL } from '@/lib/markets';
import type { Phase } from '@/lib/types';
import { useNow } from '@/hooks/use-now';
import { Hint } from './ui/tooltip';
import { Pill } from './ui/status';

const SPORT_ICON: Record<string, typeof Crosshair> = { cs2: Crosshair, lol: Swords };

export function SportIcon({ sport, className }: { sport: string; className?: string }) {
  const Icon = SPORT_ICON[sport] ?? Gamepad2;
  return (
    <Hint content={SPORT_LABEL[sport] ?? sport}>
      <Icon className={cn('size-4 shrink-0 stroke-[1.5] text-muted-fg', className)} aria-label={SPORT_LABEL[sport] ?? sport} />
    </Hint>
  );
}

/** "alliance vs sinners" — cắt ngắn tên dài, đủ tên khi hover/chạm. */
export function Teams({ teams, className, strong = true }: { teams: [string, string]; className?: string; strong?: boolean }) {
  const full = `${teams[0]} vs ${teams[1]}`;
  return (
    <Hint content={full.length > 34 ? full : null}>
      <span className={cn('flex min-w-0 items-baseline gap-1.5', className)}>
        <span className={cn('min-w-0 max-w-[48%] truncate', strong && 'font-medium text-fg')}>{teams[0]}</span>
        <span className="shrink-0 text-caption text-faint">vs</span>
        <span className={cn('min-w-0 truncate', strong && 'font-medium text-fg')}>{teams[1]}</span>
      </span>
    </Hint>
  );
}

export function PhasePill({ phase }: { phase: Phase }) {
  return phase === 'live' ? (
    <Pill tone="ok">Live</Pill>
  ) : (
    <span className="whitespace-nowrap text-caption text-muted-fg">Trước trận</span>
  );
}

/** Giờ bắt đầu tương đối; tuyệt đối khi hover. */
export function StartsAt({ at, className }: { at: number; className?: string }) {
  const now = useNow(15_000);
  return (
    <Hint content={fmtStamp(at)}>
      <span className={cn('cursor-default whitespace-nowrap text-caption text-muted-fg', className)}>{fmtStarts(at, now)}</span>
    </Hint>
  );
}
