'use client';

import { useEffect, useState } from 'react';
import { Layers } from 'lucide-react';
import { api } from '@/lib/api';
import type { StakePlan, StakePreview, StakeTrend, TierStakeOverride } from '@/lib/trading-types';
import { cn } from '@/lib/utils';
import { Field, Input, Segmented, Switch } from '../ui/controls';
import { Empty } from '../ui/states';
import { Table, TD, TH, THead, TR } from '../ui/table';
import { tierRange } from '../consumers/notify-channels';

const TREND_LABEL: Record<StakeTrend, string> = { flat: 'Ngang', up: 'Tăng dần', down: 'Giảm dần', custom: 'Tùy chỉnh' };
const TREND_HELP: Record<StakeTrend, string> = {
  flat: 'Mọi hạng cùng một số tiền.',
  up: 'Hạng cao hơn (margin lớn hơn) vào nhiều tiền hơn: mỗi hạng × (1 + bước).',
  down: 'Hạng cao hơn vào ít tiền hơn: mỗi hạng ÷ (1 + bước).',
  custom: 'Tự nhập tiền cho từng hạng trong bảng bên dưới; hạng để trống = không vào lệnh.',
};

const money = (n: number) => `${+n.toFixed(2)}$`;

/** Số trong ô nhập: rỗng = undefined (dùng giá trị tự tính). */
const parseNum = (s: string): number | undefined => {
  if (!s.trim()) return undefined;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/**
 * Kế hoạch vốn theo hạng kèo (dùng chung hạng với kênh thông báo): xu hướng giữa các hạng
 * + mức tối thiểu/tối đa, xem trước bảng tiền do backend tính (cùng công thức worker dùng).
 */
export function StakePlanEditor({ value, onChange }: { value: StakePlan; onChange: (p: StakePlan) => void }) {
  const [preview, setPreview] = useState<StakePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<StakePlan>) => onChange({ ...value, ...p });
  const setOverride = (tierId: string, o: TierStakeOverride) => {
    const next = { ...value.overrides[tierId], ...o };
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as TierStakeOverride;
    const overrides = { ...value.overrides };
    if (Object.keys(clean).length) overrides[tierId] = clean;
    else delete overrides[tierId];
    onChange({ ...value, overrides });
  };

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api<StakePreview>('trading/stake-preview', { method: 'POST', body: JSON.stringify(value) })
        .then((p) => {
          if (!alive) return;
          setPreview(p);
          setError(null);
        })
        .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [value]);

  const custom = value.trend === 'custom';
  return (
    <div className="flex flex-col gap-6">
      <Field label="Xu hướng tiền giữa các hạng" help={TREND_HELP[value.trend]}>
        <Segmented<StakeTrend>
          value={value.trend}
          onChange={(trend) => set({ trend })}
          options={(Object.keys(TREND_LABEL) as StakeTrend[]).map((t) => ({ value: t, label: TREND_LABEL[t] }))}
        />
      </Field>
      {!custom ? (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Tiền hạng thấp nhất ($)" htmlFor="sp-base" help="Tính trên chân csgoempire.">
            <NumInput id="sp-base" value={value.baseStake} onValue={(v) => set({ baseStake: v ?? 0 })} />
          </Field>
          {value.trend !== 'flat' ? (
            <Field label="Bước mỗi hạng (%)" htmlFor="sp-step" help="50 = ×1.5 mỗi hạng.">
              <NumInput id="sp-step" value={+(value.stepPct * 100).toFixed(4)} onValue={(v) => set({ stepPct: (v ?? 0) / 100 })} />
            </Field>
          ) : null}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Tối thiểu (% tiền hạng)" htmlFor="sp-min" help="Sổ lệnh mỏng chỉ vào được ít hơn mức này → bỏ qua.">
          <NumInput id="sp-min" value={+(value.minStakeRatio * 100).toFixed(4)} onValue={(v) => set({ minStakeRatio: Math.min(1, (v ?? 0) / 100) })} />
        </Field>
        <Field label="Tối đa (× tiền hạng)" htmlFor="sp-max" help="Trần khi tăng dần trong hạng.">
          <NumInput id="sp-max" value={value.maxStakeRatio} onValue={(v) => set({ maxStakeRatio: Math.max(1, v ?? 1) })} />
        </Field>
      </div>
      <Field
        label="Tăng dần trong hạng"
        htmlFor="sp-scale"
        help="Bật: margin ở cận dưới của hạng → tiền của hạng, càng gần cận trên → càng gần mức tối đa. Hạng không có cận trên luôn dùng tiền của hạng."
      >
        <Switch id="sp-scale" checked={value.scaleWithinTier} onCheckedChange={(scaleWithinTier) => set({ scaleWithinTier })} label="Tăng dần trong hạng" />
      </Field>

      <div>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <span className="text-body font-medium text-fg">Bảng tiền theo hạng</span>
          <span className="text-caption text-faint">ô trống = tự tính</span>
        </div>
        {error ? <p className="mb-2 text-caption text-critical">{error}</p> : null}
        {preview && !preview.rows.length ? (
          <Empty icon={Layers}>Chưa có hạng kèo. Thêm hạng ở trang Consumer → Hạng kèo; trader chỉ vào lệnh với kèo thuộc một hạng.</Empty>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Hạng</TH>
                <TH numeric>Tiền</TH>
                <TH numeric>Tối thiểu</TH>
                <TH numeric>Tối đa</TH>
              </tr>
            </THead>
            <tbody>
              {(preview?.rows ?? []).map((r) => {
                const o = value.overrides[r.tierId] ?? {};
                return (
                  <TR key={r.tierId}>
                    <TD>
                      <span className="block text-fg">{r.tierName}</span>
                      <span className="num block text-caption text-muted-fg">{tierRange({ id: r.tierId, name: r.tierName, minMargin: r.minMargin, maxMargin: r.maxMargin })}</span>
                    </TD>
                    <TD numeric>
                      {custom ? (
                        <CellInput label={`Tiền ${r.tierName}`} value={o.stake} placeholder="0" onValue={(stake) => setOverride(r.tierId, { stake })} />
                      ) : (
                        <span className={cn(r.stake > 0 ? 'text-fg' : 'text-faint')}>{money(r.stake)}</span>
                      )}
                    </TD>
                    <TD numeric>
                      <CellInput label={`Tối thiểu ${r.tierName}`} value={o.minStake} placeholder={String(r.minStake)} onValue={(minStake) => setOverride(r.tierId, { minStake })} />
                    </TD>
                    <TD numeric>
                      <CellInput label={`Tối đa ${r.tierName}`} value={o.maxStake} placeholder={String(r.maxStake)} onValue={(maxStake) => setOverride(r.tierId, { maxStake })} />
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>
    </div>
  );
}

/** Ô số giữ chữ người dùng gõ (vd "1."), chỉ báo giá trị khi hợp lệ. */
export function NumInput({ id, value, onValue }: { id: string; value: number; onValue: (v: number | undefined) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (parseNum(text) !== value) setText(String(value));
  }, [value]);
  return (
    <Input
      id={id}
      inputMode="decimal"
      className="num"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseNum(e.target.value);
        if (v !== undefined) onValue(v);
      }}
    />
  );
}

function CellInput({
  label,
  value,
  placeholder,
  onValue,
}: {
  label: string;
  value: number | undefined;
  placeholder: string;
  onValue: (v: number | undefined) => void;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    if (parseNum(text) !== value) setText(value === undefined ? '' : String(value));
  }, [value]);
  return (
    <Input
      aria-label={label}
      inputMode="decimal"
      className="num ml-auto h-8 w-24 text-right"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onValue(parseNum(e.target.value));
      }}
    />
  );
}
