/** Giới hạn chung cho các WebSocket server (chống client chưa xác thực chiếm tài nguyên). */
export interface WsServerLimits {
  /** Địa chỉ nghe. '127.0.0.1' khi đứng sau reverse proxy cùng máy (cổng WS không lộ ra ngoài). */
  readonly host?: string;
  /** Kích thước tối đa một frame (byte). Vượt → thư viện ws đóng kết nối (1009). */
  readonly maxPayloadBytes?: number;
  /** Chưa gửi hello hợp lệ trong khoảng này → đóng kết nối. */
  readonly helloTimeoutMs?: number;
}

/** Frame điều khiển (hello, ack, subscribe...) rất nhỏ. */
export const SMALL_FRAME_BYTES = 64 * 1024;
export const DEFAULT_HELLO_TIMEOUT_MS = 10_000;
