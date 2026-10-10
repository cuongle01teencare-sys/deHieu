# API

Base URL: `http://<host>:${PORT}` (mặc định `3000`).

**Tài liệu tương tác (Swagger UI):** `http://<host>:${PORT}/docs` — sinh từ code nên luôn khớp bản đang chạy, gọi thử được ngay (bấm Authorize để nhập token). OpenAPI JSON: `/docs-json`. Tắt bằng `API_DOCS_ENABLED=false`.

## Xác thực và phân quyền

Mọi endpoint (trừ `GET /`) đều cần header:

```
Authorization: Bearer <token>
```

- **Token** khai báo trong env `API_TOKENS`: `token:principalId:role1|role2`, phân tách bằng dấu phẩy.
- **Endpoint chỉ yêu cầu QUYỀN** (vd `tasks:manage`), không yêu cầu vai trò. Vai trò nào có quyền nào là cấu hình.
- `401`: thiếu/sai token. `403`: token hợp lệ nhưng thiếu quyền.

### Vai trò mặc định

| Vai trò | Quyền |
|---|---|
| `admin` | `*` (tất cả) |
| `manager` | `tasks:*`, `team-aliases:*`, `arbitrage-settings:*`, `consumers:*`, `arbitrage:read` |
| `staff` | `tasks:read`, `team-aliases:*`, `consumers:read`, `arbitrage:read` |
| `viewer` | `*:read` |

Thêm/ghi đè vai trò bằng env `ROLE_PERMISSIONS` (JSON), không cần sửa code:

```
ROLE_PERMISSIONS={"moderator":["team-aliases:*","arbitrage:read"]}
```

Quyền dạng `tài-nguyên:hành-động`; `*` dùng được ở từng phần (`tasks:*`, `*:read`).

---

## Publisher (tasks)

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/tasks?tenant=` | `tasks:read` | Danh sách publisher: trạng thái, heartbeat, seq, số lần restart, lỗi gần nhất |
| GET | `/tasks/kinds` | `tasks:read` | Các `kind` app chạy được và tenant tương ứng |
| GET | `/tasks/:taskId` | `tasks:read` | Một publisher |
| POST | `/tasks` | `tasks:manage` | Tạo + chạy publisher |
| POST | `/tasks/:taskId/stop` | `tasks:manage` | Dừng publisher (odds của nó bị gỡ, kèo liên quan bị hủy) |
| DELETE | `/tasks/:taskId` | `tasks:manage` | Xóa hồ sơ task đã dừng (STOPPED/FAILED); đang chạy → 400 |
| POST | `/tasks/:taskId/commands` | `tasks:command` | Gửi lệnh vào task đang chạy, body `{ "name": "...", "data": ... }` |

Body `POST /tasks`:

```jsonc
{
  "taskId": "sptpub-live",          // duy nhất
  "kind": "sptpub.live",            // xem bảng kind bên dưới; tenant được app tự suy từ kind
  "runtime": { "type": "worker" },  // hoặc { "type": "remote", "nodeId": "node-1" }
  "params": { ... }                 // tham số riêng của kind
}
```

Mỗi tenant có 3 khái niệm dữ liệu: **descriptor** (metadata), **live**, **prematch**.
Mỗi `kind` chỉ chạy **một** instance (start trùng → `400 KIND_ALREADY_RUNNING`).

| kind | Khái niệm | params |
|---|---|---|
| `sptpub.descriptor` | descriptor | `baseUrl`, `brandId`, `lang`, `intervalMs` (60000) |
| `sptpub.live` | live | `baseUrl`, `brandId`, `lang`, `intervalMs` (1000), `maxConsecutiveErrors?` |
| `sptpub.prematch` | prematch | `baseUrl`, `brandId`, `lang`, `intervalMs` (2000), `maxConsecutiveErrors?` |
| `polymarket.descriptor` | descriptor (danh sách trận + token) | `tagIds` (vd `[100639]`), `intervalMs` (30000), `live?`, `pageSize?`, `endpoints?` |
| `polymarket.stream` | live + prematch (app tự tách theo trạng thái trận) | `assetIds?`, `resubscribeDebounceMs?`, `endpoints?` — token do app tự gửi qua lệnh `subscribe` |

`kind` không có trong danh mục → `400 UNKNOWN_KIND`.

Trạng thái publisher: `CREATED → INITIALIZING → READY → STARTING → RUNNING → STOPPING → STOPPED`, khi lỗi `RESTARTING` (1s, 2s, 4s… tối đa 30s), quá 5 lần liên tiếp → `FAILED`.

## Kèo arbitrage

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/arbitrage/signals` | `arbitrage:read` | Kèo đang hiệu lực |
| GET | `/arbitrage/stats` | `arbitrage:read` | Tổng quan: số room (`total`, `matched` ≥2 tenant, `withCombos`, `aboveMinMargin`), `byTenant` (số dòng, open/suspended, `newestAgeMs`), bộ đếm evaluator (`evaluations`, `roomsEvaluated`, `issued`/`refreshed`/`cancelled`), `activeSignals` |
| GET | `/arbitrage/rooms?q=&tenant=&sport=&phase=&matched=&limit=&offset=` | `arbitrage:read` | Danh sách room (id `room`, đội, tenant, `bestMargin`), sắp theo `bestMargin` giảm dần |
| GET | `/arbitrage/rooms/{room}` ví dụ `/arbitrage/rooms/room:cs2:alliance~sinners:game-winner` | `arbitrage:read` | Chi tiết room: odds từng tenant (parse + chuỗi gốc, `ageMs`), các tổ hợp + margin, kèo đang hiệu lực |
| GET | `/arbitrage/history?status=&phase=&room=&from=&to=&limit=50&offset=0` | `arbitrage:read` | Lịch sử kèo đã phát (mới nhất trước) |
| GET | `/arbitrage/history/:signalId` | `arbitrage:read` | Một kèo trong lịch sử |
| GET | `/arbitrage/lanes` | `arbitrage:read` | Làn xử lý theo tenant × phase: `queued`, `processed`, `coalesced`, `busy` |
| GET | `/arbitrage/settings` | `arbitrage-settings:read` | Cấu hình |
| PATCH | `/arbitrage/settings` | `arbitrage-settings:write` | Sửa cấu hình (gửi trường cần đổi) |

Cấu hình:

| Trường | Mặc định | Ý nghĩa |
|---|---|---|
| `minMargin` | `0.02` | Ngưỡng lợi nhuận tối thiểu (2%). Dưới ngưỡng = hủy kèo |
| `marginStep` | `0.01` | Lời tăng thêm ≥ 1% → kèo mới ghi đè kèo cũ |
| `signalTtlMs` | `30000` | Thời hạn kèo; còn nguyên thì phát lại |
| `maxStartDriftMs` | `1200000` | Hai chân chỉ ghép khi giờ bắt đầu lệch ≤ 20 phút |
| `enabledPhases` | `["live","prematch"]` | Kênh được tạo kèo. Tắt một kênh → kèo đang sống của kênh đó bị hủy (`phase_disabled`), odds vẫn được cập nhật |

Kèo có bất kỳ chân nào live thì `phase = live`.

### Lịch sử kèo

`status`: `active` (đang sống) · `superseded` (bị kèo mới hơn của cùng tổ hợp ghi đè, có `supersededBy`) · `cancelled` (có `statusReason`) · `abandoned` (app khởi động lại khi kèo còn sống, `statusReason = app_restart`).
Lịch sử được ghi nền, không làm chậm việc gửi kèo.

## Bí danh tên đội

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/team-aliases` | `team-aliases:read` | Danh sách |
| POST | `/team-aliases` | `team-aliases:write` | `{ "alias": "NIP", "canonical": "Ninjas in Pyjamas" }` (tự chuẩn hóa) |
| DELETE | `/team-aliases/:id` | `team-aliases:write` | Xóa |

## Consumer (bot giao dịch, Discord)

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/consumers` | `consumers:read` | Consumer đang/đã kết nối: online, tạm dừng, số frame chờ ack |
| GET | `/consumers/hub` | `consumers:read` | `activeSignals`, `pendingDeliveries`, danh sách kèo đang sống, consumer |
| POST | `/consumers/:id/pause` | `consumers:control` | Tạm dừng gửi kèo cho consumer |
| POST | `/consumers/:id/resume` | `consumers:control` | Tiếp tục |

## Vận hành (admin)

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/health` | công khai | Kiểm tra Dragonfly/Redis + Postgres ngay lúc gọi. 200 = ok, 503 = có phụ thuộc lỗi |
| GET | `/admin/snapshot` | `admin:read` | Toàn cảnh: sự cố đang mở, health, tasks, nodes, consumers, số liệu arbitrage, lanes, settings |
| GET | `/admin/incidents?open=&kind=&limit=&offset=` | `admin:read` | `open=true` → sự cố đang mở; bỏ trống → lịch sử (mới nhất trước) |
| POST | `/admin/incidents/{key}/ack` | `admin:incidents` | Xác nhận đã biết sự cố (vẫn mở tới khi hết thật) |
| GET | `/admin/audit?principalId=&method=&route=&from=&to=` | `admin:read` | Mọi request POST/PUT/PATCH/DELETE: ai, route, params/body (đã che bí mật), kết quả |
| GET | `/admin/odds-transitions?room=&tenant=&to=&from=&until=` | `admin:read` | Dòng kèo xuất hiện (`from=null`), open↔suspended, bị gỡ (`to=removed` + reason). Giữ `ODDS_TRANSITION_RETENTION_DAYS` ngày |

### Sự cố (mức 1)

Watchdog kiểm tra mỗi 5 giây; mỗi sự cố có `key` ổn định nên chỉ mở **một lần** và báo khi **mở** và khi **hết**. Mở lại trong vòng 5 phút (chập chờn) thì ghi nhận nhưng không báo lại.

| kind | key | Mức | Khi nào |
|---|---|---|---|
| `task.failed` | `task.failed:{taskId}` | critical | Task hết lượt khởi động lại (FAILED) |
| `task.flapping` | `task.flapping:{taskId}` | warning | ≥ 3 lần lỗi liên tiếp |
| `source.stale` | `source.stale:{taskId}` | critical | RUNNING nhưng không có dữ liệu quá ngưỡng: 5× `intervalMs` (≥ 30s); task stream: 15 phút |
| `node.down` | `node.down:{nodeId}` | critical | Node mất kết nối > 15s |
| `infra.down` | `infra.down:{dragonfly\|postgres}` | critical | Health check lỗi (kiểm tra mỗi 10s, timeout 3s) |
| `consumer.down` | `consumer.down:{consumerId}` | critical (trader) / warning | Consumer mất kết nối > 30s |
| `consumer.backlog` | `consumer.backlog:{consumerId}` | warning | ≥ 50 kèo chưa được ack |
| `lane.backlog` | `lane.backlog:{lane}` | warning | ≥ 1000 cập nhật đang chờ trong làn |

Kênh báo: luôn ghi log (`[Alerts]`); thêm Discord khi đặt `DISCORD_ALERT_WEBHOOK_URL`. Khi app khởi động lại, sự cố còn mở từ lần trước được đóng với `resolution = app_restart` (trạng thái trong RAM đã mất; watchdog sẽ mở lại nếu vẫn còn lỗi).

---

## WebSocket

### Consumer → app (`ws://<host>:${CONSUMER_WS_PORT}`, mặc định 3002)

```
consumer → { "type":"hello", "v":1, "consumerId":"trader-1", "role":"trader"|"discord"|"other", "token":"<CONSUMER_WS_TOKEN>" }
app      → { "type":"welcome", "paused":false }            (+ gửi lại các kèo còn hiệu lực)
app      → { "type":"signal", "deliveryId", "kind":"issued"|"refreshed", "signal":{...}, "supersedes"? }
app      → { "type":"cancel", "deliveryId", "signalId", "room", "comboId", "reason": <xem bảng lý do> }
consumer → { "type":"ack", "deliveryId" }                  (bắt buộc; chưa ack app sẽ gửi lại mỗi 2s)
app      → { "type":"control", "action":"pause"|"resume" }
hai chiều: { "type":"heartbeat", "at": <ms> }
```

Lý do hủy (`reason`):

| reason | Ý nghĩa |
|---|---|
| `below_threshold` | Lợi nhuận tụt dưới ngưỡng tối thiểu |
| `leg_suspended` | Một chân đang bị khóa odds |
| `leg_removed` | Odds của một chân bị gỡ (trận/market bị gỡ hoặc kết thúc) |
| `start_time_mismatch` | Giờ bắt đầu giữa hai bên lệch quá `maxStartDriftMs` |
| `publisher_stopped` | Publisher cung cấp một chân đã chết hẳn hoặc bị dừng |
| `phase_disabled` | Kênh (live/prematch) của kèo bị tắt |

`signal.phase`: `live` | `prematch`. `signal.legs[i]`: `{ tenant, side, team, odds, ref }`. `ref` là ID gốc để đặt lệnh:
- sptpub: `e` (eventId), `m` (marketId), `s` (specifier), `o0`/`o1` (outcomeId của đội `teams[0]`/`teams[1]`)
- polymarket: `c` (conditionId), `slug`, `t0`/`t1` (tokenId của đội `teams[0]`/`teams[1]`)

### Microservice publisher → app (`ws://<host>:${TASK_WS_PORT}`, mặc định 3001)

Dùng nội bộ bởi `pnpm start:task-runner`, xác thực bằng `TASK_WS_TOKEN`.

### Dashboard admin → app (`ws://<host>:${ADMIN_WS_PORT}`, mặc định 3003)

Xác thực bằng token trong `API_TOKENS` (cần quyền `admin:read`, vai trò `viewer` trở lên). Mỗi frame là một JSON.

```text
client → app
  { "type": "hello", "token": "<token>", "topics": ["alerts","tasks","nodes","consumers","metrics"] }   // bắt buộc trong 10s
  { "type": "subscribe",   "topics": ["signals", "room:room:cs2:alliance~sinners:game-winner"] }
  { "type": "unsubscribe", "topics": ["signals"] }
  { "type": "resync" }   // xin lại snapshot
  { "type": "ping" }

app → client
  { "type": "welcome", "principal": { "id", "roles" }, "topics": [...] }
  { "type": "snapshot", "data": <giống GET /admin/snapshot> }      // ngay sau welcome
  { "type": "event", "event": { "type", "topic", "at", "data" } }   // theo topic đã subscribe
  { "type": "metrics", "data": { evaluator, activeSignals, rooms, lanes, consumers, tasks } }  // mỗi ~2s
  { "type": "room", "room": "<id>", "data": <giống GET /arbitrage/rooms/{room}> }  // khi subscribe room
  { "type": "rejected", "reason" } | { "type": "error", "message" } | { "type": "pong" }
```

| Topic | Sự kiện (`event.type`) |
|---|---|
| `alerts` | `incident.opened`, `incident.resolved`, `incident.acknowledged` |
| `tasks` | `task.state` (from → to, reason), `task.error`, `task.removed` |
| `nodes` | `node.connected`, `node.disconnected` (kèm task bị ảnh hưởng) |
| `consumers` | `consumer.connected`, `consumer.disconnected` |
| `signals` | `signal.issued` (kèm `supersedes`), `signal.refreshed`, `signal.cancelled` (kèm `reason`) |
| `odds` | `odds.transition`: xuất hiện / open↔suspended / bị gỡ |
| `audit` | `audit.recorded` |
| `metrics` | frame `metrics` định kỳ |
| `room:{roomId}` | `odds.changed`: mọi thay đổi giá/trạng thái của đúng room đó (tối đa 20 room mỗi kết nối) |

Không có topic stream toàn bộ odds: tần suất quá cao. Muốn xem odds thì subscribe từng room đang mở trên màn hình.
