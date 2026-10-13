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

/** Nội dung tin nhắn trung lập; adapter tự định dạng theo từng nền tảng. */
export interface NotifyMessage {
  readonly title: string;
  readonly lines: readonly string[];
  /** Link kèm theo (trang trận của tenant...). */
  readonly links: readonly { readonly label: string; readonly url: string }[];
}

/** Port: gửi một tin nhắn tới một kênh. Ném lỗi khi thất bại (adapter tự xử lý 429/thử lại). */
export interface NotifySender {
  send(channel: NotifyChannel, message: NotifyMessage): Promise<void>;
}

export const NOTIFY_SENDER = Symbol('NOTIFY_SENDER');
