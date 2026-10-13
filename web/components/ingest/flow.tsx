'use client';

import { useEffect, useRef, useState } from 'react';
import { fmtRate } from '@/lib/format';
import { tenantVar } from '@/lib/tenants';
import { SKIP_REASONS } from '@/lib/skip-reasons';
import { cn } from '@/lib/utils';
import { Popover } from '../ui/menu';
import { compact, type FlowBranch, type FlowModel } from './model';

const T0 = 76; // độ dày tối đa (px)
const MIN_T = 3;
const H = 330;
const CY = 128; // trục giữa dải chính
const DROP_Y = 268; // nơi nhánh rơi xuống

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e!.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/**
 * Sankey trái → phải vẽ thẳng trên nền trang (không khung).
 * Dải chính co lại theo phần đi tiếp; phần bỏ qua / gộp rơi xuống dưới và mờ dần; lỗi màu đỏ.
 */
export function FlowChart({ model, onBranch }: { model: FlowModel; onBranch?: (b: FlowBranch) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const W = Math.max(width, 960);
  const color = model.tenant ? tenantVar(model.tenant) : 'var(--accent)';
  const gid = `f-${model.tenant ?? 'all'}`;

  // cột: nguồn + các chặng
  const cols = model.stages.length + 1;
  const padL = 200;
  const padR = 90;
  const xs = Array.from({ length: cols }, (_, i) => padL + (i * (W - padL - padR)) / (cols - 1));

  // độ dày từng chặng
  const th: number[] = [T0];
  model.stages.forEach((s, i) => {
    if (i < model.stages.length - 1) th.push(Math.max(MIN_T, th[i]! * s.keep));
  });

  // nguồn xếp chồng bên trái
  const totalRecv = model.sources.reduce((n, s) => n + s.received, 0) || 1;
  const gap = 30;
  const srcT = model.sources.map((s) => Math.max(MIN_T, (s.received / totalRecv) * T0));
  const srcH = srcT.reduce((a, b) => a + b, 0) + gap * (model.sources.length - 1);
  let yCursor = CY - srcH / 2;
  const srcY = srcT.map((t) => {
    const y = yCursor;
    yCursor += t + gap;
    return y;
  });

  const ribbon = (x1: number, a1: number, b1: number, x2: number, a2: number, b2: number) => {
    const mx = (x1 + x2) / 2;
    return `M${x1},${a1} C${mx},${a1} ${mx},${a2} ${x2},${a2} L${x2},${b2} C${mx},${b2} ${mx},${b1} ${x1},${b1} Z`;
  };

  return (
    <div ref={ref} className="w-full overflow-x-auto scrollbar-none">
      <svg width={W} height={H} className="block" role="img" aria-label="Sơ đồ luồng dữ liệu theo chặng">
        <defs>
          <linearGradient id={`${gid}-main`} x1="0" x2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.32" />
            <stop offset="1" stopColor={color} stopOpacity="0.2" />
          </linearGradient>
          {(['muted', 'warn', 'critical'] as const).map((t) => (
            <linearGradient key={t} id={`${gid}-drop-${t}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={t === 'muted' ? 'var(--fg-muted)' : `var(--${t})`} stopOpacity={t === 'critical' ? 0.55 : 0.22} />
              <stop offset="1" stopColor={t === 'muted' ? 'var(--fg-muted)' : `var(--${t})`} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {/* nguồn → Nhận */}
        {(() => {
          let acc = CY - T0 / 2;
          return model.sources.map((s, i) => {
            const share = (srcT[i]! / srcT.reduce((a, b) => a + b, 0)) * T0;
            const a2 = acc;
            acc += share;
            return (
              <path
                key={s.kind}
                d={ribbon(xs[0]!, srcY[i]!, srcY[i]! + srcT[i]!, xs[1]!, a2, a2 + share)}
                fill={`url(#${gid}-main)`}
                className="transition-[d] duration-300"
              />
            );
          });
        })()}

        {/* chặng → chặng + nhánh rơi */}
        {model.stages.map((s, i) => {
          if (i === model.stages.length - 1) return null;
          const x1 = xs[i + 1]!;
          const x2 = xs[i + 2]!;
          const t1 = th[i]!;
          const t2 = th[i + 1]!;
          const top1 = CY - t1 / 2;
          const top2 = CY - t2 / 2;
          let off = top1 + t2;
          const total = s.value + s.branches.reduce((n, b) => n + b.value, 0) || 1;
          return (
            <g key={s.id}>
              <path d={ribbon(x1, top1, top1 + t2, x2, top2, top2 + t2)} fill={`url(#${gid}-main)`} />
              {s.branches.map((b, bi) => {
                if (b.value <= 0) return null;
                const w = Math.max(2, Math.min(t1 - t2, (b.value / total) * t1) || 2);
                const ya = Math.min(off, top1 + t1 - w);
                off = ya + w;
                const xe = x1 + (x2 - x1) * (0.5 + bi * 0.2);
                const d = `M${x1},${ya} C${(x1 + xe) / 2},${ya} ${xe},${ya} ${xe},${Math.max(ya + 30, DROP_Y - 30)} L${xe},${DROP_Y} L${xe - w},${DROP_Y} L${xe - w},${Math.max(ya + 30, DROP_Y - 30)} C${xe - w},${ya + w} ${(x1 + xe) / 2},${ya + w} ${x1},${ya + w} Z`;
                const tone = b.tone;
                return (
                  <g key={b.id}>
                    <path d={d} fill={`url(#${gid}-drop-${tone})`} className={cn(b.rising && 'animate-pulse-soft')} />
                    <foreignObject x={xe - w - 4} y={DROP_Y + 4} width={150} height={44}>
                      <BranchLabel b={b} onClick={onBranch} />
                    </foreignObject>
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* nhãn nguồn */}
        {model.sources.map((s, i) => (
          <g key={s.kind}>
            <rect x={xs[0]! - 2} y={srcY[i]} width={3} height={srcT[i]} rx={1.5} fill={s.stale ? 'var(--warn)' : color} />
            <text x={xs[0]! - 12} y={srcY[i]! + srcT[i]! / 2 - 3} textAnchor="end" className="fill-fg font-mono text-[12px]">
              {s.kind}
            </text>
            <text x={xs[0]! - 12} y={srcY[i]! + srcT[i]! / 2 + 12} textAnchor="end" className={cn('font-mono text-[11px]', s.stale ? 'fill-warn' : 'fill-faint')}>
              {s.stale ? 'không có dữ liệu' : `${fmtRate(s.rate)}/s · ${compact(s.received)}`}
            </text>
          </g>
        ))}

        {/* nút chặng */}
        {model.stages.map((s, i) => {
          const x = xs[i + 1]!;
          const t = th[i]!;
          const top = CY - t / 2;
          return (
            <g key={s.id}>
              <rect x={x - 1.5} y={top} width={3} height={t} rx={1.5} fill={color} />
              <text x={x} y={CY - T0 / 2 - 34} textAnchor="middle" className="fill-muted-fg text-[12px]">
                {s.label}
              </text>
              <text x={x} y={CY - T0 / 2 - 14} textAnchor="middle" className="fill-fg font-mono text-[15px] font-medium">
                {compact(s.value)}
              </text>
              <text x={x} y={CY + T0 / 2 + 22} textAnchor="middle" className="fill-faint font-mono text-[11px]">
                {s.rate != null ? `${fmtRate(s.rate)}/s` : s.sub}
              </text>
              {s.rate != null && s.sub ? (
                <text x={x} y={CY + T0 / 2 + 38} textAnchor="middle" className="fill-faint font-mono text-[11px]">
                  {s.sub}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function BranchLabel({ b, onClick }: { b: FlowBranch; onClick?: (b: FlowBranch) => void }) {
  const body = (
    <button
      type="button"
      onClick={() => onClick?.(b)}
      className={cn(
        'flex flex-col items-start text-left text-[11px] leading-4',
        b.tone === 'critical' ? 'text-critical' : b.tone === 'warn' ? 'text-warn' : 'text-muted-fg',
        b.reasons?.length && 'hover:underline decoration-dotted underline-offset-2',
      )}
    >
      <span>
        {b.label}
        {b.rising ? ' · đang tăng' : ''}
      </span>
      <span className="font-mono text-faint">{compact(b.value)}</span>
    </button>
  );
  if (!b.reasons?.length) return body;
  return (
    <Popover trigger={body} className="w-80">
      <ReasonList b={b} />
    </Popover>
  );
}

export function ReasonList({ b }: { b: FlowBranch }) {
  const total = b.reasons!.reduce((n, r) => n + r.value, 0) || 1;
  return (
    <div>
      <div className="mb-2 text-body font-medium text-fg">{b.label}</div>
      <ul className="flex flex-col">
        {b.reasons!.map((r) => {
          const info = r.reason === 'failed' ? { label: 'Lỗi xử lý', help: 'Ngoại lệ khi dịch bản tin.', tone: 'critical' as const } : SKIP_REASONS[r.reason];
          return (
            <li key={r.reason} className="border-b border-line py-2 last:border-0">
              <div className="flex items-baseline gap-2">
                <span className={cn('text-body', info.tone === 'critical' ? 'text-critical' : 'text-fg')}>{info.label}</span>
                <span className="num text-micro text-faint">{r.reason}</span>
                <span className="num ml-auto text-caption text-fg">{compact(r.value)}</span>
                <span className="num w-10 text-right text-micro text-faint">{((r.value / total) * 100).toFixed(0)}%</span>
              </div>
              <p className="mt-0.5 text-caption text-muted-fg">{info.help}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Mobile: các chặng xếp dọc, dải dày = khối lượng, nhánh rơi ghi lệch phải. */
export function FlowVertical({ model }: { model: FlowModel }) {
  const color = model.tenant ? tenantVar(model.tenant) : 'var(--accent)';
  const th: number[] = [1];
  model.stages.forEach((s, i) => i < model.stages.length - 1 && th.push(Math.max(0.04, th[i]! * s.keep)));
  return (
    <ol className="flex flex-col">
      <li className="flex gap-4 pb-4">
        <div className="flex w-14 shrink-0 justify-center">
          <div className="w-px bg-line" />
        </div>
        <div className="flex-1">
          <div className="text-caption text-muted-fg">Publisher</div>
          {model.sources.map((s) => (
            <div key={s.kind} className="mt-1 flex items-baseline justify-between gap-3">
              <span className="num truncate text-caption text-fg">{s.kind}</span>
              <span className={cn('num shrink-0 text-caption', s.stale ? 'text-warn' : 'text-muted-fg')}>{s.stale ? 'không có dữ liệu' : `${fmtRate(s.rate)}/s`}</span>
            </div>
          ))}
        </div>
      </li>
      {model.stages.map((s, i) => (
        <li key={s.id} className="flex gap-4">
          <div className="flex w-14 shrink-0 justify-center">
            <div className="rounded-full" style={{ width: `${Math.max(3, th[i]! * 56)}px`, background: color, opacity: 0.35 }} />
          </div>
          <div className="min-w-0 flex-1 pb-5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-body text-fg">{s.label}</span>
              <span className="num text-[15px] font-medium text-fg">{compact(s.value)}</span>
            </div>
            <div className="num mt-0.5 flex justify-between text-caption text-faint">
              <span>{s.sub}</span>
              <span>{s.rate != null ? `${fmtRate(s.rate)}/s` : ''}</span>
            </div>
            {s.branches.filter((b) => b.value > 0).map((b) => (
              <div key={b.id} className={cn('mt-2 flex items-baseline justify-between pl-3 text-caption', b.tone === 'critical' ? 'text-critical' : b.tone === 'warn' ? 'text-warn' : 'text-muted-fg')}>
                <span>↳ {b.label}{b.rising ? ' · đang tăng' : ''}</span>
                <span className="num">{compact(b.value)}</span>
              </div>
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}
