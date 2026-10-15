'use client';

import type { SignalCloseDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Table, TD, TH, THead, TR } from './ui/table';
import { Tenant } from './ui/tenant';

/** "10:45 · 15/10" theo giờ máy người xem. */
export const fmtStart = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())} · ${p(d.getDate())}/${p(d.getMonth() + 1)}`;
};

/** ms → "45 phút" / "1 giờ 20 phút" / "30 giây". */
export const fmtDrift = (ms: number) => {
  const min = Math.round(Math.abs(ms) / 60_000);
  if (min < 1) return `${Math.round(Math.abs(ms) / 1000)} giây`;
  const h = Math.floor(min / 60);
  return h ? `${h} giờ${min % 60 ? ` ${min % 60} phút` : ''}` : `${min} phút`;
};

/** Một dòng tóm tắt độ lệch (dùng cạnh lý do hủy). */
export const driftSummary = (d: SignalCloseDetail | null | undefined) =>
  d?.startDriftMs != null ? `lệch ${fmtDrift(d.startDriftMs)} (cho phép ≤ ${fmtDrift(d.maxStartDriftMs)})` : null;

/**
 * Giờ bắt đầu từng chân: lúc kèo phát (theo kèo) và lúc hủy (theo room), kèm thay đổi + độ lệch.
 * Không có dữ liệu nào → null.
 */
export function StartTimeDetail({
  legs,
  detail,
}: {
  legs?: readonly { tenant: string; startsAt?: number | null }[];
  detail?: SignalCloseDetail | null;
}) {
  const tenants = [...new Set([...(legs ?? []).map((l) => l.tenant), ...(detail?.startTimes ?? []).map((t) => t.tenant)])];
  const at = (t: string) => legs?.find((l) => l.tenant === t)?.startsAt ?? null;
  const end = (t: string) => detail?.startTimes.find((x) => x.tenant === t)?.startsAt ?? null;
  if (!tenants.some((t) => at(t) !== null || end(t) !== null)) return null;
  const issuedDrift = (() => {
    const v = tenants.map(at).filter((x): x is number => x !== null);
    return v.length === 2 ? Math.abs(v[0]! - v[1]!) : null;
  })();
  const over = detail?.startDriftMs != null && detail.startDriftMs > detail.maxStartDriftMs;
  return (
    <div className="flex flex-col gap-2">
      <Table>
        <THead>
          <tr>
            <TH>Sàn</TH>
            <TH numeric>Lúc phát kèo</TH>
            {detail ? <TH numeric>Lúc hủy</TH> : null}
            {detail ? <TH numeric>Thay đổi</TH> : null}
          </tr>
        </THead>
        <tbody>
          {tenants.map((t) => {
            const a = at(t);
            const b = end(t);
            const moved = a !== null && b !== null ? b - a : null;
            return (
              <TR key={t}>
                <TD>
                  <Tenant tenant={t} />
                </TD>
                <TD numeric className="num">
                  {a !== null ? fmtStart(a) : <span className="text-faint">—</span>}
                </TD>
                {detail ? (
                  <TD numeric className="num">
                    {b !== null ? fmtStart(b) : <span className="text-faint">đã gỡ</span>}
                  </TD>
                ) : null}
                {detail ? (
                  <TD numeric className={cn('num', moved ? 'text-warn' : 'text-faint')}>
                    {moved === null ? '—' : moved === 0 ? 'không đổi' : `${moved > 0 ? 'dời sau' : 'dời trước'} ${fmtDrift(moved)}`}
                  </TD>
                ) : null}
              </TR>
            );
          })}
        </tbody>
      </Table>
      <p className="text-caption text-muted-fg">
        {issuedDrift !== null ? `Lúc phát lệch ${fmtDrift(issuedDrift)}` : null}
        {issuedDrift !== null && detail?.startDriftMs != null ? ' → ' : null}
        {detail?.startDriftMs != null ? (
          <span className={cn(over && 'font-medium text-critical')}>
            lúc hủy lệch {fmtDrift(detail.startDriftMs)}
          </span>
        ) : null}
        {detail ? ` · cho phép ≤ ${fmtDrift(detail.maxStartDriftMs)}` : null}
      </p>
    </div>
  );
}
