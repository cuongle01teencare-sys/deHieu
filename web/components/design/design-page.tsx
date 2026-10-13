'use client';

import { useEffect, useState } from 'react';
import { Bell, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { fmtHM } from '@/lib/format';
import { Button } from '../ui/button';
import { Segmented, Switch } from '../ui/controls';
import { Eyebrow, PageHeader, Section } from '../ui/layout';
import { Confirm, Panel } from '../ui/panel';
import { SegmentBar, Sparkline, Stat, StatStrip, Meter } from '../ui/stats';
import { SkeletonRows } from '../ui/states';
import { DotLabel, Pill, StatusDot, type Tone } from '../ui/status';
import { Coverage, Tenant } from '../ui/tenant';
import { Age, Margin, OddsCell } from '../ui/values';
import { ConnectionPill } from '../shell/topbar';
import { LogoMark } from '../shell/wordmark';
import { TEMPLATES } from '../notify/notify-page';

const SURFACES = ['bg', 'raised', 'hover', 'line', 'line-strong'];
const TEXT = ['fg', 'fg-muted', 'fg-faint'];
const SEMANTIC = ['accent', 'ok', 'warn', 'critical', 'info', 'muted'];
const TENANTS = ['tenant-1', 'tenant-2', 'tenant-3', 'tenant-4', 'tenant-5'];

function Swatch({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="size-5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_var(--line-strong)]" style={{ background: `var(--${name})` }} />
      <span className="num text-caption text-fg">--{name}</span>
    </div>
  );
}

/** Tokens + component lõi + mẫu thông báo đẩy trên màn hình khóa. */
export function DesignPage() {
  const [odds, setOdds] = useState<[number, number]>([1.75, 2.1]);
  const [panel, setPanel] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [seg, setSeg] = useState('a');
  const [sw, setSw] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setOdds(([a, b]) => [Math.round((a + (Math.random() - 0.5) * 0.1) * 100) / 100, b]), 2_500);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <PageHeader title="Hệ thống thiết kế" description="Tokens và component dùng chung. Đổi giao diện sáng/tối trong menu tài khoản để xem cả hai biến thể." />

      <Section title="Màu">
        <div className="grid gap-x-12 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Bề mặt', SURFACES],
            ['Chữ', TEXT],
            ['Ngữ nghĩa', SEMANTIC],
            ['Tenant (Okabe–Ito)', TENANTS],
          ].map(([label, list]) => (
            <div key={label as string}>
              <Eyebrow className="mb-2">{label as string}</Eyebrow>
              {(list as string[]).map((n) => (
                <Swatch key={n} name={n} />
              ))}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Chữ">
        <div className="flex flex-col gap-4">
          <div className="flex items-baseline gap-6"><span className="num w-28 text-caption text-faint">24 / title</span><span className="text-title font-semibold">Chi tiết trận</span></div>
          <div className="flex items-baseline gap-6"><span className="num w-28 text-caption text-faint">15 / section</span><span className="text-section font-semibold">Sức khỏe tenant</span></div>
          <div className="flex items-baseline gap-6"><span className="num w-28 text-caption text-faint">13 / body</span><span className="text-body">Kèo bị hủy mờ dần kèm lý do.</span></div>
          <div className="flex items-baseline gap-6"><span className="num w-28 text-caption text-faint">12 / caption</span><span className="text-caption text-muted-fg">cập nhật 3s trước</span></div>
          <div className="flex items-baseline gap-6"><span className="num w-28 text-caption text-faint">mono</span><span className="num text-body">2.10 · +2.35% · room:cs2:alliance~sinners</span></div>
        </div>
      </Section>

      <Section title="Trạng thái">
        <div className="flex flex-wrap items-center gap-6">
          {(['ok', 'warn', 'critical', 'info', 'muted', 'accent'] as Tone[]).map((t) => (
            <DotLabel key={t} tone={t} className="text-body">{t}</DotLabel>
          ))}
          <StatusDot tone="ok" pulse label="đang sống" />
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Pill tone="ok">RUNNING</Pill>
          <Pill tone="warn">RESTARTING</Pill>
          <Pill tone="critical">FAILED</Pill>
          <Pill tone="info">STARTING</Pill>
          <Pill tone="muted">STOPPED</Pill>
          <Pill tone="ok">có kèo</Pill>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-6">
          <Tenant tenant="sptpub" />
          <Tenant tenant="polymarket" />
          <Tenant tenant="betfair" />
          <Coverage coverage={{ sptpub: 13, polymarket: 6 }} />
          <ConnectionPill status="stream" lastFrameAt={Date.now() - 1000} />
          <ConnectionPill status="reconnecting" lastFrameAt={Date.now() - 9000} />
          <ConnectionPill status="stream" lastFrameAt={null} online={false} />
        </div>
      </Section>

      <Section title="Ô odds" description="open · suspended · stale · empty · đang đổi · tốt nhất">
        <div className="grid max-w-3xl grid-cols-[140px_1fr] items-center gap-y-3 text-caption text-muted-fg">
          <span>Mở</span><OddsCell odds={[1.75, 2.1]} status="open" ageMs={1200} />
          <span>Tốt nhất mỗi phía</span><OddsCell odds={[1.8, 2.15]} status="open" ageMs={900} best={[true, true]} />
          <span>Tạm khóa</span><OddsCell odds={[1.8, 2.05]} status="suspended" ageMs={45000} />
          <span>Cũ (stale)</span><OddsCell odds={[1.8, 2.05]} status="open" ageMs={52000} />
          <span>Trống</span><OddsCell odds={null} />
          <span>Đang đổi</span><OddsCell odds={odds} status="open" ageMs={800} />
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-8">
          <Margin value={0.0341} min={0.02} size="xl" />
          <Margin value={0.0092} min={0.02} size="lg" />
          <Margin value={-0.012} min={0.02} size="lg" />
          <Age ms={3000} />
          <Age ms={125000} />
          <Age ms={95000} staleAfter={30000} />
        </div>
      </Section>

      <Section title="Dải chỉ số">
        <StatStrip>
          <Stat size="lg" label="Kèo đang sống" value="24" spark={[18, 20, 19, 22, 21, 24, 23, 24]} tone="ok" />
          <Stat label="Room · đã ghép" value="1,902" sub="/ 1,284" />
          <Stat label="Vượt ngưỡng 2%" value="24" />
          <Stat label="Consumer · chờ ack" value="5/6" sub="59" tone="warn" />
        </StatStrip>
        <div className="mt-8 grid max-w-3xl gap-8 md:grid-cols-2">
          <SegmentBar segments={[{ key: 'r', label: 'RUNNING', value: 12, tone: 'ok' }, { key: 's', label: 'RESTARTING', value: 3, tone: 'warn' }, { key: 'f', label: 'FAILED', value: 1, tone: 'critical' }, { key: 'x', label: 'STOPPED', value: 2, tone: 'muted' }]} />
          <div className="flex flex-col gap-3">
            <Meter value={0.9} tone="ok" />
            <Meter value={0.72} />
            <Sparkline values={[3, 5, 4, 7, 6, 9, 8, 11]} className="h-6 w-40" />
          </div>
        </div>
      </Section>

      <Section title="Điều khiển">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary"><Plus /> Tạo task</Button>
          <Button>Phụ</Button>
          <Button variant="outline">Viền</Button>
          <Button variant="ghost">Xác nhận</Button>
          <Button variant="danger">Dừng</Button>
          <Button variant="primary" disabledReason="Thiếu quyền tasks:command">Gửi lệnh</Button>
          <Segmented value={seg} onChange={setSeg} options={[{ value: 'a', label: 'Tất cả' }, { value: 'b', label: 'sptpub' }, { value: 'c', label: 'polymarket' }]} />
          <Switch checked={sw} onCheckedChange={setSw} label="switch" />
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => setPanel(true)}>Mở drawer / bottom sheet</Button>
          <Button variant="outline" onClick={() => setConfirm(true)}>Hộp xác nhận</Button>
          <Button variant="outline" onClick={() => toast.success('Đã xác nhận sự cố')}>Toast</Button>
          <Button variant="outline" onClick={() => toast('Có phiên bản mới', { action: { label: 'Tải lại', onClick: () => location.reload() } })}>Toast cập nhật</Button>
        </div>
        <Panel open={panel} onOpenChange={setPanel} eyebrow="room:cs2:alliance~sinners:game-winner" title="Thắng trận">
          <p className="text-body text-muted-fg">Desktop: drawer phải, không phủ nền. Mobile: bottom sheet có tay nắm.</p>
        </Panel>
        <Confirm open={confirm} onOpenChange={setConfirm} tone="danger" title="Dừng sptpub-live?" description="Odds của task bị gỡ và kèo liên quan bị hủy." confirmLabel="Dừng task" onConfirm={() => setConfirm(false)} />
      </Section>

      <Section title="Trạng thái tải">
        <SkeletonRows rows={3} cols={[30, 15, 15, 10]} />
      </Section>

      <Section title="Thông báo đẩy trên màn hình khóa" description="Mẫu hiển thị trên iOS (PWA đã cài) và Android (Chrome)">
        <div className="flex flex-wrap gap-10">
          <LockScreen os="ios" />
          <LockScreen os="android" />
        </div>
      </Section>
    </div>
  );
}

/** Mô phỏng màn hình khóa (minh họa — không phải giao diện app). */
function LockScreen({ os }: { os: 'ios' | 'android' }) {
  const now = Date.now();
  return (
    <figure className="flex flex-col gap-3">
      <div
        className="relative h-[560px] w-[290px] overflow-hidden rounded-[44px] p-3 text-white shadow-[0_0_0_8px_#111,0_0_0_9px_#333]"
        style={{ background: os === 'ios' ? 'linear-gradient(160deg,#1b2440,#0b0f1c 60%,#1a1222)' : 'linear-gradient(170deg,#14231f,#0a0f10 65%)' }}
      >
        <div className="mt-12 text-center">
          <div className="text-[13px] opacity-80">Thứ Hai, 12 tháng 10</div>
          <div className={os === 'ios' ? 'text-[68px] font-semibold leading-none tracking-tight' : 'text-[60px] font-light leading-none'}>{fmtHM(now)}</div>
        </div>
        <div className="absolute inset-x-3 bottom-16 flex flex-col gap-2">
          {TEMPLATES.map((t, i) =>
            os === 'ios' ? (
              <div key={t.kind} className="rounded-[20px] bg-white/18 px-3.5 py-3 backdrop-blur-xl" style={{ background: 'rgba(255,255,255,0.16)' }}>
                <div className="flex items-start gap-2.5">
                  <LogoMark className="size-8 rounded-[8px]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-semibold">{t.title}</span>
                      <span className="shrink-0 text-[11px] opacity-60">{i === 0 ? 'bây giờ' : `${i * 4} phút`}</span>
                    </div>
                    <div className="line-clamp-2 text-[12.5px] leading-snug opacity-90">{t.body}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div key={t.kind} className="rounded-[18px] px-3.5 py-3" style={{ background: 'rgba(32,38,40,0.92)' }}>
                <div className="mb-1 flex items-center gap-1.5 text-[11px] opacity-70">
                  <LogoMark className="size-4 rounded-full" /> Arb Ops · {i === 0 ? 'bây giờ' : `${i * 4} phút`}
                  <Bell className="ml-auto size-3" />
                </div>
                <div className="truncate text-[13px] font-medium">{t.title}</div>
                <div className="line-clamp-2 text-[12px] leading-snug opacity-80">{t.body}</div>
              </div>
            ),
          )}
        </div>
      </div>
      <figcaption className="text-center text-caption text-muted-fg">{os === 'ios' ? 'iOS 16.4+ · web app đã cài' : 'Android · Chrome'}</figcaption>
    </figure>
  );
}
