/**
 * Kiểu dữ liệu trả về từ backend (NestJS) — viết tay theo docs/API.md và mã nguồn backend.
 * Khi backend đổi định dạng, sửa ở đây trước rồi để TypeScript chỉ ra chỗ hỏng.
 */
export type Phase = 'live' | 'prematch';

export interface HealthResult {
  name: string; // 'dragonfly' | 'postgres'
  ok: boolean;
  latencyMs: number;
  error: string | null;
  checkedAt: number;
}

export interface Incident {
  id: string;
  key: string;
  kind: string;
  severity: 'warning' | 'critical';
  title: string;
  message: string;
  details: Record<string, unknown>;
  openedAt: number;
  lastSeenAt: number;
  resolvedAt: number | null;
  resolution: string | null;
  acknowledgedAt: number | null;
  acknowledgedBy: string | null;
}

export type TaskState =
  | 'CREATED'
  | 'INITIALIZING'
  | 'READY'
  | 'STARTING'
  | 'RUNNING'
  | 'STOPPING'
  | 'STOPPED'
  | 'RESTARTING'
  | 'FAILED';

export interface TaskRecord {
  spec: {
    taskId: string;
    tenant: string;
    kind: string;
    params: Record<string, unknown>;
    runtime: { type: 'worker' } | { type: 'remote'; nodeId: string };
  };
  state: TaskState;
  consecutiveFailures: number;
  totalRestarts: number;
  lastHeartbeatAt: number | null;
  lastDataAt: number | null;
  lastSeq: number | null;
  lastError: string | null;
  updatedAt: number;
}

export interface NodeView {
  nodeId: string;
  connected: boolean;
  connectedAt: number | null;
  disconnectedAt: number | null;
  tasks: number;
}

export interface ConsumerView {
  consumerId: string;
  role: string;
  connected: boolean;
  paused: boolean;
  pending: number;
  lastSeenAt: number;
}

export interface ConsumerHubStats {
  activeSignals: number;
  pendingDeliveries: number;
  signals: ArbitrageSignal[];
  consumers: ConsumerView[];
}

export interface RoomsOverview {
  total: number;
  matched: number;
  withCombos: number;
  aboveMinMargin: number;
  minMargin: number;
  byTenant: Record<
    string,
    { lines: number; open: number; suspended: number; newestAgeMs: number }
  >;
}

export interface EvaluatorStats {
  evaluations: number;
  roomsEvaluated: number;
  lastEvaluatedAt: number | null;
  issued: number;
  refreshed: number;
  cancelled: number;
  cancelledByReason: Record<string, number>;
  errors: number;
  lastError: string | null;
}

export interface ArbitrageStats {
  rooms: RoomsOverview;
  evaluator: EvaluatorStats;
  activeSignals: number;
}

export interface LaneStats {
  lane: string; // 'sptpub:live'
  queued: number;
  processed: number;
  coalesced: number;
  busy: boolean;
  lastProcessedAt: number | null;
}

export type SkipReason =
  | 'parse_failed'
  | 'unsupported_event'
  | 'unsupported_sport'
  | 'invalid_event'
  | 'unsupported_market'
  | 'unsupported_line'
  | 'missing_fields'
  | 'same_team_names'
  | 'no_moneyline_teams'
  | 'unknown_asset';

export interface IngestCounter {
  tenant: string;
  kind: string;
  received: number;
  failed: number;
  set: number;
  remove: number;
  skipped: Partial<Record<SkipReason, number>>;
  lastReceivedAt: number | null;
  lastChangeAt: number | null;
}

export interface IngestSnapshot {
  since: number;
  at: number;
  items: IngestCounter[];
}

export interface ArbitrageSettings {
  minMargin: number;
  marginStep: number;
  signalTtlMs: number;
  maxStartDriftMs: number;
  enabledPhases: Phase[];
}

export interface AdminSnapshot {
  at: number;
  incidents: Incident[];
  health: HealthResult[];
  tasks: TaskRecord[];
  nodes: NodeView[];
  consumers: ConsumerView[];
  arbitrage: ArbitrageStats;
  lanes: LaneStats[];
  settings: ArbitrageSettings;
  retention: unknown;
}

/** Frame `metrics` của stream admin (~2s). */
export interface AdminMetrics {
  at: number;
  evaluator: EvaluatorStats;
  activeSignals: number;
  rooms: RoomsOverview;
  roomsAt: number;
  lanes: LaneStats[];
  consumers: { total: number; connected: number; pending: number };
  tasks: Record<string, number>;
  ingest: IngestSnapshot;
}

export interface RoomListItem {
  room: string;
  sport: string;
  market: string;
  teams: [string, string];
  picks: [string, string];
  tenants: string[];
  phases: Phase[];
  bestMargin: number | null;
  aboveMinMargin: boolean;
  startsAt: number;
  lastUpdatedAt: number;
}

export interface ListResult<T> {
  total: number;
  items: T[];
}

export interface RoomLineView {
  odds: [number, number];
  status: 'open' | 'suspended';
  phase: Phase;
  updatedAt: number;
  ageMs: number;
  startsAt: number;
  ref: Record<string, string>;
  raw: string;
}

export interface ArbitrageLeg {
  tenant: string;
  side: 0 | 1;
  pick: string;
  odds: number;
  ref: Record<string, string>;
}

export interface ArbitrageSignal {
  signalId: string;
  room: string;
  sport: string;
  market: string;
  teams: [string, string];
  comboId: string;
  phase: Phase;
  margin: number;
  legs: [ArbitrageLeg, ArbitrageLeg];
  issuedAt: number;
  expiresAt: number;
}

export interface RoomDetailView {
  room: string;
  sport: string;
  market: string;
  teams: [string, string];
  lines: Record<string, RoomLineView>;
  combos: {
    comboId: string;
    phase: Phase;
    margin: number;
    aboveMinMargin: boolean;
    legs: { tenant: string; pick: string; odds: number }[];
  }[];
  minMargin: number;
  activeSignals: ArbitrageSignal[];
}

export interface OpsEvent {
  type: string;
  topic: string;
  at: number;
  data: Record<string, unknown>;
}

/** Thông tin người dùng web hiển thị ở client (không có token). */
export interface WebUser {
  username: string;
  name: string;
  role: string;
  /** Quyền dạng `tài-nguyên:hành-động` (hỗ trợ `*`). Thiếu = suy từ vai trò, mặc định toàn quyền. */
  permissions: string[];
}

// ===================== Trận đấu (GET /arbitrage/matches) =====================

export interface MatchListItem {
  match: string; // 'cs2:alliance~sinners'
  sport: string;
  teams: [string, string];
  tenants: string[];
  markets: number;
  matchedMarkets: number;
  coverage: Record<string, number>;
  phases: Phase[];
  bestMargin: number | null;
  aboveMinMargin: boolean;
  startsAt: number;
  lastUpdatedAt: number;
}

export interface MatchLine {
  odds: [number, number];
  status: 'open' | 'suspended';
  phase: Phase;
  ageMs: number;
  startsAt: number;
  ref: Record<string, string>;
}

export interface MatchMarketRow {
  market: string;
  room: string;
  picks: [string, string];
  lines: Record<string, MatchLine>;
  combos: number;
  bestMargin: number | null;
  aboveMinMargin: boolean;
  /** Số kèo đang hiệu lực của room (nếu backend trả). */
  activeSignals?: number;
}

export interface MatchDetail {
  match: string;
  sport: string;
  teams: [string, string];
  tenants: string[];
  phases: Phase[];
  startsAt: number;
  minMargin: number;
  markets: MatchMarketRow[];
}

// ===================== Ghép trượt (GET /arbitrage/match-candidates) =====================

export interface CandidateSide {
  match: string;
  teams: [string, string];
  tenants: string[];
  startsAt: number;
}

export interface MatchCandidate {
  score: number;
  startsDiffMs: number;
  a: CandidateSide;
  b: CandidateSide;
  pairs: [string, string][];
  aliases: { alias: string; canonical: string; similarity: number }[];
}

// ===================== Lịch sử kèo (GET /arbitrage/history) =====================

export type SignalStatus = 'active' | 'superseded' | 'cancelled' | 'abandoned';

export interface SignalHistoryItem extends ArbitrageSignal {
  status: SignalStatus;
  statusReason: string | null;
  supersededBy: string | null;
  endedAt: number | null;
}

// ===================== Bí danh, audit, chuyển trạng thái odds =====================

export interface TeamAlias {
  id: string;
  alias: string;
  canonical: string;
  createdAt: number;
  createdBy: string | null;
}

export interface AuditEntry {
  id: string;
  at: number;
  principalId: string;
  method: string;
  route: string;
  params: Record<string, unknown>;
  body: unknown;
  status: number;
  ok: boolean;
  durationMs: number;
}

export interface OddsTransition {
  id: string;
  at: number;
  room: string;
  tenant: string;
  from: 'open' | 'suspended' | null;
  to: 'open' | 'suspended' | 'removed';
  reason: string | null;
  odds: [number, number] | null;
}

/** Tham số của một kind, đã chuẩn hóa để sinh form. */
export interface TaskKindParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'number[]' | 'json';
  required: boolean;
  default?: unknown;
  hint?: string;
}

/**
 * GET /tasks/kinds — backend trả `{ kind, tenant, paramsSchema }` (JSON Schema sinh từ zod).
 * `params` là dạng đã chuẩn hóa (xem `normalizeKind`).
 */
export interface TaskKindInfo {
  kind: string;
  tenant: string;
  paramsSchema?: unknown;
  concept?: 'descriptor' | 'live' | 'prematch' | 'stream';
  params?: TaskKindParam[];
}
