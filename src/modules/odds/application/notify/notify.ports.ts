import type { NotifyChannel, SignalTier } from '../../domain/notify-channel.js';

/** Port: nơi lưu bền hạng kèo + kênh thông báo (Postgres). */
export interface NotifyConfigRepository {
  listTiers(): Promise<SignalTier[]>;
  saveTier(tier: SignalTier): Promise<void>;
  /** Xóa hạng và gỡ hạng đó khỏi mọi kênh. */
  deleteTier(id: string): Promise<boolean>;
  listChannels(): Promise<NotifyChannel[]>;
  saveChannel(channel: NotifyChannel): Promise<void>;
  deleteChannel(id: string): Promise<boolean>;
}

export const NOTIFY_CONFIG_REPOSITORY = Symbol('NOTIFY_CONFIG_REPOSITORY');

/** Loại tin — adapter dùng để chọn màu/biểu tượng. */
export type NotifyKind = 'issued' | 'updated' | 'cancelled' | 'test';

/** Một ô thông tin (Discord: field của embed; nền tảng khác: một dòng "tên: giá trị"). */
export interface NotifyField {
  readonly name: string;
  readonly value: string;
  /** Hiển thị cạnh nhau (Discord tối đa 3 ô/hàng). */
  readonly inline?: boolean;
}

/**
 * Nội dung tin nhắn trung lập, có cấu trúc; adapter tự định dạng theo từng nền tảng
 * (Discord: embed có màu; Telegram: HTML; Slack: mrkdwn). Chữ đậm trong `value`/`description`
 * viết bằng **...** — adapter chuyển sang cú pháp của nền tảng.
 */
export interface NotifyMessage {
  readonly kind: NotifyKind;
  readonly title: string;
  /** 1–2 dòng tóm tắt dưới tiêu đề (trận, market). */
  readonly description: string;
  readonly fields: readonly NotifyField[];
  /** Link kèm theo (trang trận của tenant...). */
  readonly links: readonly { readonly label: string; readonly url: string }[];
  /** Dòng nhỏ cuối tin (hạn kèo, id). */
  readonly footer?: string;
  readonly at: number;
}

/** Port: gửi một tin nhắn tới một kênh. Ném lỗi khi thất bại (adapter tự xử lý 429/thử lại). */
export interface NotifySender {
  send(channel: NotifyChannel, message: NotifyMessage): Promise<void>;
}

export const NOTIFY_SENDER = Symbol('NOTIFY_SENDER');
