'use client';

import { useEffect, useState } from 'react';
import { BellRing, Laptop, Send, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_PREFS, loadPrefs, savePrefs, sendTestNotification, type PushPrefs } from '@/lib/push';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { Input, Select, Switch } from '../ui/controls';
import { Eyebrow, PageHeader, Section } from '../ui/layout';
import { Pill } from '../ui/status';
import { IosInstallSheet, PushPromptSheet, useInstallState } from '../shell/pwa';
import { NotificationList } from '../shell/notifications';

/** Tùy chọn thông báo đẩy (OneSignal) cho thiết bị này + danh sách thiết bị + gửi thử. */
export function NotifyPage() {
  const [prefs, setPrefs] = useState<PushPrefs>(DEFAULT_PREFS);
  const [sheet, setSheet] = useState<'push' | 'ios' | null>(null);
  const install = useInstallState();
  useEffect(() => setPrefs(loadPrefs()), []);
  const update = (p: Partial<PushPrefs>) => {
    const n = { ...prefs, ...p };
    setPrefs(n);
    savePrefs(n);
  };

  const status = installStatus(install);

  const rows: { key: keyof PushPrefs; title: string; desc: string; extra?: React.ReactNode }[] = [
    { key: 'critical', title: 'Sự cố nghiêm trọng', desc: 'Publisher FAILED, node mất kết nối, Redis/Postgres lỗi.' },
    { key: 'warning', title: 'Sự cố cảnh báo', desc: 'Publisher khởi động lại liên tục, consumer tồn kèo, làn xử lý tồn.' },
    {
      key: 'signals',
      title: 'Kèo vượt ngưỡng · kèo On click',
      desc: 'Khi margin của kèo mới đạt ngưỡng bạn đặt. Mỗi kèo mới lên trang On click (chờ người vào lệnh) cũng báo về đây, không phụ thuộc ngưỡng; tắt mục này là tắt cả hai.',
      extra: (
        <Select
          value={String(prefs.signalThreshold)}
          onChange={(e) => update({ signalThreshold: Number(e.target.value) })}
          disabled={!prefs.signals}
          className="mt-3 w-36"
          aria-label="Ngưỡng margin"
        >
          {[0.02, 0.025, 0.03, 0.04, 0.05].map((v) => (
            <option key={v} value={v}>
              margin ≥ {(v * 100).toFixed(v * 100 % 1 ? 1 : 0)}%
            </option>
          ))}
        </Select>
      ),
    },
    { key: 'anomalies', title: 'Dữ liệu bất thường', desc: 'Bản tin sai định dạng tăng, tenant gỡ hàng loạt dòng kèo.' },
    {
      key: 'quietHours',
      title: 'Giờ yên lặng',
      desc: 'Không rung/chuông trong khoảng này (trừ sự cố nghiêm trọng).',
      extra: (
        <div className="mt-3 flex items-center gap-2">
          <Input type="time" value={prefs.quietFrom} onChange={(e) => update({ quietFrom: e.target.value })} disabled={!prefs.quietHours} className="num w-28" aria-label="Từ" />
          <span className="text-caption text-faint">đến</span>
          <Input type="time" value={prefs.quietTo} onChange={(e) => update({ quietTo: e.target.value })} disabled={!prefs.quietHours} className="num w-28" aria-label="Đến" />
        </div>
      ),
    },
    { key: 'actionableOnly', title: 'Chỉ khi có thao tác cần làm', desc: 'Bỏ thông báo thuần thông tin; chỉ báo khi cần xác nhận hoặc xử lý.' },
  ];

  return (
    <div className="max-w-2xl">
      <PageHeader title="Thông báo" description="Thông báo đẩy qua OneSignal tới điện thoại và trình duyệt đã cài Arb Ops." />

      {/* trạng thái thiết bị này — tiêu điểm */}
      <div className="mb-12 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <span className="grid size-10 place-items-center rounded-[10px] bg-accent-soft text-accent-text">
            <BellRing className="size-5 stroke-[1.5]" />
          </span>
          <div>
            <div className="text-section font-semibold text-fg">Thiết bị này</div>
            <Pill tone={status.tone} className="mt-1">
              {status.text}
            </Pill>
          </div>
        </div>
        <div className="flex gap-2">
          {install.sdkState === 'ready' && install.permission === 'granted' && install.subscribed ? (
            <Button
              variant="secondary"
              onClick={async () => {
                const ok = await sendTestNotification();
                toast[ok ? 'success' : 'error'](ok ? 'Đã hiển thị thông báo thử cục bộ' : 'Không hiển thị được — kiểm tra quyền thông báo');
              }}
            >
              <Send /> Thử trên thiết bị
            </Button>
          ) : install.sdkState !== 'disabled' && install.ios && !install.standalone ? (
            <Button variant="primary" onClick={() => setSheet('ios')}>
              Hướng dẫn cài
            </Button>
          ) : install.sdkState === 'ready' && install.support === 'supported' && (install.permission === 'default' || install.permission === 'granted') ? (
            <Button variant="primary" onClick={() => setSheet('push')}>
              Bật thông báo
            </Button>
          ) : null}
        </div>
      </div>

      <Section title="Nhận thông báo cho">
        <ul>
          {rows.map((r) => (
            <li key={r.key} className="border-b border-line py-4 last:border-0">
              <label className="flex items-start justify-between gap-6">
                <span className="min-w-0">
                  <span className="block text-body font-medium text-fg">{r.title}</span>
                  <span className="mt-0.5 block text-caption text-muted-fg">{r.desc}</span>
                </span>
                <Switch checked={Boolean(prefs[r.key])} onCheckedChange={(v) => update({ [r.key]: v } as Partial<PushPrefs>)} label={r.title} />
              </label>
              {r.extra}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Thiết bị" description="Trạng thái đăng ký nhận thông báo trên thiết bị này">
        <ul>
          <li className="flex min-h-14 items-center gap-4 border-b border-line py-3">
            {install.standalone || install.ios ? <Smartphone className="size-4 stroke-[1.5] text-muted-fg" /> : <Laptop className="size-4 stroke-[1.5] text-muted-fg" />}
            <div className="min-w-0 flex-1">
              <div className="text-body text-fg">
                {install.standalone ? 'Arb Ops (đã cài)' : 'Trình duyệt này'} <span className="text-caption text-accent-text">· thiết bị này</span>
              </div>
              <div className="text-caption text-muted-fg">{status.text}</div>
            </div>
          </li>
          <li className="py-3 text-caption text-faint">Nút thử trên thiết bị chỉ kiểm tra hiển thị cục bộ. Kiểm tra nhận push thực tế bằng cách gửi thông báo từ OneSignal dashboard.</li>
        </ul>
      </Section>

      <Section title="Mẫu thông báo" description="Tiêu đề + nội dung + nơi mở khi chạm">
        <NotificationTemplates />
      </Section>

      <Section title="Gần đây" className="md:hidden">
        <NotificationList max={5} />
      </Section>

      <PushPromptSheet open={sheet === 'push'} onOpenChange={(v) => setSheet(v ? 'push' : null)} onDone={() => setSheet(null)} />
      <IosInstallSheet open={sheet === 'ios'} onOpenChange={(v) => setSheet(v ? 'ios' : null)} />
    </div>
  );
}

function installStatus(install: ReturnType<typeof useInstallState>) {
  if (install.sdkState === 'disabled') return { tone: 'muted' as const, text: 'Thông báo đẩy chưa được cấu hình' };
  if (install.ios && !install.standalone) return { tone: 'warn' as const, text: 'Cần thêm vào Màn hình chính' };
  if (install.support === 'unsupported') return { tone: 'muted' as const, text: 'Trình duyệt không hỗ trợ' };
  if (install.sdkState === 'error') return { tone: 'critical' as const, text: 'Không kết nối được dịch vụ thông báo — hãy tải lại trang' };
  if (install.sdkState === 'loading') return { tone: 'muted' as const, text: 'Đang kết nối dịch vụ thông báo…' };
  if (install.permission === 'granted' && install.subscribed) return { tone: 'ok' as const, text: 'Đã bật trên thiết bị này' };
  if (install.permission === 'denied') return { tone: 'critical' as const, text: 'Trình duyệt đang chặn thông báo' };
  return { tone: 'muted' as const, text: 'Chưa đăng ký nhận thông báo' };
}

export const TEMPLATES = [
  {
    kind: 'critical',
    title: '🔴 Publisher sptpub-live FAILED',
    body: 'Lỗi liên tiếp 5 lần — chạm để xem',
    link: '/publisher?task=sptpub-live',
    target: 'Chi tiết task',
  },
  {
    kind: 'signal',
    title: 'Kèo +3.4% · cs2 alliance vs sinners',
    body: 'map-handicap-p1.5 · sptpub alliance +1.5 @ 1.75 | polymarket sinners -1.5 @ 2.40',
    link: '/tran-dau/cs2%3Aalliance~sinners?market=map-handicap-p1.5',
    target: 'Chi tiết trận',
  },
  {
    kind: 'data',
    title: 'Polymarket gỡ 42% market trong một vòng quét',
    body: 'Có thể do API lỗi — chạm để kiểm tra',
    link: '/ingest?tenant=polymarket',
    target: 'Luồng dữ liệu',
  },
] as const;

function NotificationTemplates() {
  return (
    <ul>
      {TEMPLATES.map((t) => (
        <li key={t.kind} className="border-b border-line py-4 last:border-0">
          <Eyebrow className={cn('mb-1.5', t.kind === 'critical' ? 'text-critical' : t.kind === 'signal' ? 'text-ok' : 'text-warn')}>{t.kind}</Eyebrow>
          <div className="text-body font-medium text-fg">{t.title}</div>
          <div className="mt-0.5 text-caption text-muted-fg">{t.body}</div>
          <a href={`${t.link}${t.link.includes('?') ? '&' : '?'}from=push`} className="num mt-1.5 inline-block text-caption text-accent-text hover:underline">
            → {t.target} · {t.link}
          </a>
        </li>
      ))}
    </ul>
  );
}
