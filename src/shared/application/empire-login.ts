export type EmpireLoginStage =
  | 'opening'
  | 'signing_in'
  | 'obtaining_session'
  | 'ready'
  | 'verification_required'
  | 'error'
  | 'cancelled';
export interface EmpireLoginStatus {
  stage: EmpireLoginStage;
  updatedAt: number;
  expiresAt: number | null;
  error: string | null;
  attemptId?: string;
  jwtAvailable?: boolean;
  diagnostic?: EmpireLoginDiagnostic;
}
export interface EmpireLoginDiagnostic {
  step:
    'browser' | 'page' | 'login' | 'currency' | 'jwt' | 'identify' | 'account';
  httpStatus?: number;
  loginRequest?: 'not_observed' | 'pending' | 'completed' | 'failed';
  verificationRequest?: 'observed' | 'failed';
  elapsedMs?: number;
  sessionIssue?:
    | 'token_malformed'
    | 'expiry_invalid'
    | 'expiry_too_short'
    | 'currency_missing'
    | 'currency_unsupported'
    | 'identify_currency_unsupported';
  /** Bước xác nhận tài khoản: vì sao không đọc được tài khoản trên sàn. */
  accountIssue?:
    | 'challenge' // Cloudflare / trang chống bot chặn
    | 'not_json' // sàn trả trang HTML thay vì dữ liệu
    | 'not_logged_in' // sàn trả success=false: trình duyệt chưa đăng nhập
    | 'http_error'
    | 'network';
  /** Lý do kỹ thuật ngắn gọn (đã che thông tin đăng nhập), để hiển thị và ghi log. */
  cause?: string;
}
export interface EmpireJwtPreview {
  token: string;
  expiresAt: number;
}
export interface EmpireCredentials {
  username: string;
  password: string;
}
