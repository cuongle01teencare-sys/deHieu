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
}
export interface EmpireJwtPreview {
  token: string;
  expiresAt: number;
}
export interface EmpireCredentials {
  username: string;
  password: string;
}
