'use client';

import { useEffect, useState } from 'react';
import { Info, Layers } from 'lucide-react';
import { api } from '@/lib/api';
import type { StakePlan, StakePreview, StakeTrend, TierStakeOverride } from '@/lib/trading-types';
import { cn } from '@/lib/utils';
import { Field, Input, Segmented, Switch } from '../ui/controls';
import { Empty } from '../ui/states';
import { Table, TD, TH, THead, TR } from '../ui/table';
import { Hint } from '../ui/tooltip';
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
        <Field
          label="Tối thiểu (% tiền hạng)"
          htmlFor="sp-min"
          help="Sổ lệnh Polymarket mỏng → worker vào nhỏ lại; nhỏ hơn mức này thì bỏ qua. 0 = vào được bao nhiêu cũng vào."
        >
          <NumInput id="sp-min" value={+(value.minStakeRatio * 100).toFixed(4)} onValue={(v) => set({ minStakeRatio: Math.min(1, (v ?? 0) / 100) })} />
        </Field>
        <Field label="Tối đa (× tiền hạng)" htmlFor="sp-max" help="Chỉ dùng khi bật Tăng dần trong hạng. ×1 = không tăng.">
          <NumInput id="sp-max" value={value.maxStakeRatio} onValue={(v) => set({ maxStakeRatio: Math.max(1, v ?? 1) })} />
        </Field>
      </div>
      <Field
        label="Tăng dần trong hạng"
        htmlFor="sp-scale"
        help="Bật: trong CÙNG một hạng, kèo margin cao hơn vào nhiều tiền hơn. Cận dưới → Tiền mục tiêu, cận trên → Tối đa, ở giữa tăng đều theo margin (tuyến tính, không theo bậc). Ví dụ hạng 1,5–3%, mục tiêu 50$, tối đa 100$: 1,5% → 50$, 2% → 66,67$, 2,5% → 83,33$, tức +3,33$ mỗi 0,1% margin. Tối thiểu giữ nguyên. Hạng không có cận trên luôn dùng Tiền mục tiêu. Khác với Bước mỗi hạng (chênh lệch GIỮA các hạng)."
      >
        <Switch id="sp-scale" checked={value.scaleWithinTier} onCheckedChange={(scaleWithinTier) => set({ scaleWithinTier })} label="Tăng dần trong hạng" />
      </Field>
      {value.scaleWithinTier && value.maxStakeRatio <= 1 && !Object.values(value.overrides).some((o) => o.maxStake !== undefined) ? (
        <p className="-mt-3 text-caption text-warn">Tối đa đang là ×1 nên bật Tăng dần trong hạng chưa có tác dụng: đặt Tối đa lớn hơn 1 (vd 2).</p>
      ) : null}

      <div>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <span className="text-body font-medium text-fg">Bảng tiền theo hạng</span>
          <span className="text-caption text-faint">ô trống = tự tính</span>
        </div>
        <p className="mb-3 text-caption text-muted-fg">
          Mọi số trong bảng là <span className="text-fg">USD cược bên csgoempire</span> cho một kèo, không phải số share. Số share Polymarket worker tự tính = tiền × odds csgoempire.
        </p>
        <HowItWorks />
        {error ? <p className="mb-2 text-caption text-critical">{error}</p> : null}
        {preview && !preview.rows.length ? (
          <Empty icon={Layers}>Chưa có hạng kèo. Thêm hạng ở trang Consumer → Hạng kèo; trader chỉ vào lệnh với kèo thuộc một hạng.</Empty>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Hạng</TH>
                <TH numeric>
                  <HeadHint label="Tiền mục tiêu ($)" hint={COL_HINT.target} />
                </TH>
                <TH numeric>
                  <HeadHint label="Tối thiểu ($)" hint={COL_HINT.min} />
                </TH>
                <TH numeric>
                  <HeadHint label="Tối đa ($)" hint={COL_HINT.max} />
                </TH>
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
                      {r.scaleWithinTier && r.stake > 0 ? (
                        <span className="num block text-caption text-faint">
                          {stepPer01(r) !== null
                            ? `${pctTxt(r.minMargin)} → ${money(r.stake)} · ${pctTxt(r.maxMargin!)} → ${money(r.maxStake)} · +${money(stepPer01(r)!)} / 0,1%`
                            : r.maxMargin === null
                              ? 'không có cận trên → luôn vào tiền mục tiêu'
                              : 'tối đa = mục tiêu → không tăng'}
                        </span>
                      ) : null}
                    </TD>
                    <TD numeric>
                      {custom ? (
                        <CellInput label={`Tiền mục tiêu ${r.tierName}`} value={o.stake} placeholder="0" onValue={(stake) => setOverride(r.tierId, { stake })} />
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

const COL_HINT = {
  target:
    'Tiền cược bên csgoempire mà worker muốn vào cho một kèo của hạng này (mức cao nhất, không bao giờ vào hơn). Từ đó worker cần mua tiền × odds share Polymarket, ví dụ 50$ @ 2.0 → 100 share. Sổ Polymarket chỉ có 80 share còn lãi → csgoempire vào 80 ÷ 2.0 = 40$. Bật Tăng dần trong hạng thì đây là mục tiêu ở cận dưới của hạng.',
  min: 'Tiền cược csgoempire thấp nhất chấp nhận được, so với TỔNG share mua được ở mọi mức giá cộng lại (không phải từng người bán). Ví dụ mục tiêu 50$, tối thiểu 35$: mua được 80 share → 40$ ≥ 35$ thì vào 40$; chỉ 60 share → 30$ thì bỏ qua cả hai chân. Giữ nguyên cho mọi margin trong hạng, kể cả khi bật Tăng dần trong hạng.',
  max: 'Chỉ dùng khi bật Tăng dần trong hạng: tiền mục tiêu tăng đều từ cột Tiền mục tiêu (ở cận dưới) lên số này (ở cận trên), theo margin của kèo. Dòng dưới tên hạng ghi rõ mỗi 0,1% margin tăng bao nhiêu. Tắt thì cột này không có tác dụng.',
} as const;

/** Tăng dần trong hạng: mục tiêu tăng thêm bao nhiêu $ mỗi 0,1% margin (null = không tăng). */
const stepPer01 = (r: { stake: number; maxStake: number; minMargin: number; maxMargin: number | null }) =>
  r.maxMargin !== null && r.maxMargin > r.minMargin && r.maxStake > r.stake
    ? ((r.maxStake - r.stake) / (r.maxMargin - r.minMargin)) * 0.001
    : null;
const pctTxt = (x: number) => `${+(x * 100).toFixed(2)}%`;

function HeadHint({ label, hint }: { label: string; hint: string }) {
  return (
    <Hint content={<span className="block max-w-72 text-left">{hint}</span>}>
      <span className="inline-flex cursor-help items-center gap-1">
        {label}
        <Info className="size-3.5 text-faint" aria-label={`Giải thích: ${label}`} />
      </span>
    </Hint>
  );
}

/** Giải thích ngắn cách worker dùng bảng (chi tiết ở Tài liệu hệ thống). */
function HowItWorks() {
  return (
    <details className="group mb-4 rounded-[8px] bg-hover/50 px-3 py-2">
      <summary className="cursor-pointer list-none text-caption font-medium text-muted-fg hover:text-fg">
        <span className="group-open:hidden">Worker dùng bảng này thế nào? ▸</span>
        <span className="hidden group-open:inline">Worker dùng bảng này thế nào? ▾</span>
      </summary>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-caption text-muted-fg">
        <li>
          Kèo đến → xếp vào hạng theo margin (nhiều hạng khớp thì lấy hạng có cận dưới cao nhất) → lấy <b className="text-fg">Tiền mục tiêu</b> của hạng.
        </li>
        <li>
          Cần mua <b className="text-fg">tiền × odds</b> share Polymarket để hai cửa nhận về như nhau (vd 50$ @ 2.0 → 100 share).
        </li>
        <li>
          Chiến lược taker ăn lệnh bán từ <b className="text-fg">giá rẻ nhất lên</b>; dừng khi đủ share, hết sổ, hết hạn mức theo trận, hoặc tới mức giá làm lãi ròng (sau phí) dưới ngưỡng lãi tối thiểu của profile.
        </li>
        <li>
          Không đủ share → <b className="text-fg">vào nhỏ lại</b>: tiền csgoempire = số share mua được ÷ odds. Kết quả nhỏ hơn <b className="text-fg">Tối thiểu</b>, hoặc dưới số share tối thiểu của market → bỏ qua, không vào chân nào.
        </li>
        <li>
          Tiền vào không bao giờ vượt <b className="text-fg">Tiền mục tiêu</b> của hạng (hoặc mức tăng dần tới <b className="text-fg">Tối đa</b> khi bật Tăng dần trong hạng).
        </li>
      </ol>
      <p className="mt-2 text-caption text-faint">Ví dụ và chi tiết: Tài liệu hệ thống → mục Auto trade.</p>
    </details>
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
