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

| Vai trò   | Quyền                                                                                |
| --------- | ------------------------------------------------------------------------------------ |
| `admin`   | `*` (tất cả)                                                                         |
| `manager` | `tasks:*`, `team-aliases:*`, `arbitrage-settings:*`, `consumers:*`, `arbitrage:read` |
| `staff`   | `tasks:read`, `team-aliases:*`, `consumers:read`, `arbitrage:read`                   |
| `viewer`  | `*:read`                                                                             |

Thêm/ghi đè vai trò bằng env `ROLE_PERMISSIONS` (JSON), không cần sửa code:

```
ROLE_PERMISSIONS={"moderator":["team-aliases:*","arbitrage:read"]}
```

Quyền dạng `tài-nguyên:hành-động`; `*` dùng được ở từng phần (`tasks:*`, `*:read`).

---

## Publisher (tasks)

| Method | Path                      | Quyền           | Mô tả                                                                         |
| ------ | ------------------------- | --------------- | ----------------------------------------------------------------------------- |
| GET    | `/tasks?tenant=`          | `tasks:read`    | Danh sách publisher: trạng thái, heartbeat, seq, số lần restart, lỗi gần nhất |
| GET    | `/tasks/kinds`            | `tasks:read`    | Các `kind` app chạy được và tenant tương ứng                                  |
| GET    | `/tasks/:taskId`          | `tasks:read`    | Một publisher                                                                 |
| POST   | `/tasks`                  | `tasks:manage`  | Tạo + chạy publisher                                                          |
| POST   | `/tasks/:taskId/start`    | `tasks:manage`  | Chạy lại task đã dừng/lỗi với đúng spec cũ (giữ cờ `persist`)                 |
| POST   | `/tasks/:taskId/stop`     | `tasks:manage`  | Dừng publisher (odds của nó bị gỡ, kèo liên quan bị hủy); task lưu bền giữ lại nhưng không tự chạy khi khởi động |
| DELETE | `/tasks/:taskId`          | `tasks:manage`  | Xóa hồ sơ task đã dừng (STOPPED/FAILED), xóa cả bản lưu bền; đang chạy → 400  |
| POST   | `/tasks/:taskId/commands` | `tasks:command` | Gửi lệnh vào task đang chạy, body `{ "name": "...", "data": ... }`            |

Body `POST /tasks`:

```jsonc
{
  "taskId": "sptpub-live",          // duy nhất
  "kind": "sptpub.live",            // xem bảng kind bên dưới; tenant được app tự suy từ kind
  "runtime": { "type": "worker" },  // hoặc { "type": "remote", "nodeId": "node-1" }
  "params": { ... },                // tham số riêng của kind
  "persist": true                   // tùy chọn: lưu Postgres, khởi động app sau tự chạy lại
}
```

**Lưu bền (`persist`)**: task được ghi vào bảng `persisted_tasks`. Lúc app khởi động, task `running` tự chạy lại
(task trên node chưa kết nối → chờ node kết nối rồi chạy), task đã bị Stop chỉ hiện ở trạng thái `STOPPED`.
Bỏ trống `persist` khi tạo lại cùng `taskId` = giữ như hồ sơ cũ.

Mỗi tenant có 3 khái niệm dữ liệu: **descriptor** (metadata), **live**, **prematch**.
`sptpub.live` / `sptpub.prematch` tự tải lại snapshot ngầm mỗi `resnapshotEveryMs` (mặc định 5s, 0 = tắt), so với bản sao trạng thái giữ trong worker và chỉ phát phần lệch (kênh `resync`): sptpub có lúc đổi/gỡ market mà không gửi delta. Khi nhận snapshot đầy đủ (lúc khởi động, đổi epoch, lỗi), translator gỡ cả trận lẫn market không còn trong snapshot.
`polymarket.descriptor` và `sptpub.descriptor` chạy được **nhiều** instance (vd mỗi môn một task polymarket với `tagIds` riêng).
Các kind còn lại chỉ chạy **một** instance (start trùng → `400 KIND_ALREADY_RUNNING`).
Môn hỗ trợ: CS2, LoL, Dota 2, Valorant (polymarket `cs2`/`lol`/`dota2`/`val`; sptpub sport `109`/`110`/`111`/`194`).

| kind                    | Khái niệm                                          | params                                                                                         |
| ----------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `sptpub.descriptor`     | descriptor                                         | `baseUrl`, `brandId`, `lang`, `intervalMs` (60000)                                             |
| `sptpub.live`           | live                                               | `baseUrl`, `brandId`, `lang`, `intervalMs` (1000), `maxConsecutiveErrors?`, `resnapshotEveryMs` (5000, 0 = tắt)                     |
| `sptpub.prematch`       | prematch                                           | `baseUrl`, `brandId`, `lang`, `intervalMs` (2000), `maxConsecutiveErrors?`, `resnapshotEveryMs` (5000, 0 = tắt)                     |
| `polymarket.descriptor` | descriptor (danh sách trận + token)                | `tagIds` (vd `[65]` LoL, `[100780]` CS2, `[102366]` Dota 2, `[101672]` Valorant), `intervalMs` (30000), `live?`, `pageSize?`, `endpoints?` |
| `polymarket.stream`     | live + prematch (app tự tách theo trạng thái trận) | `assetIds?`, `resubscribeDebounceMs?`, `endpoints?` — token do app tự gửi qua lệnh `subscribe` |

`kind` không có trong danh mục → `400 UNKNOWN_KIND`.

Trạng thái publisher: `CREATED → INITIALIZING → READY → STARTING → RUNNING → STOPPING → STOPPED`, khi lỗi `RESTARTING` (1s, 2s, 4s… tối đa 30s), quá 5 lần liên tiếp → `FAILED`.

## Kèo arbitrage

| Method | Path                                                                                     | Quyền                      | Mô tả                                                                                                                                                                                                                                         |
| ------ | ---------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/arbitrage/signals`                                                                     | `arbitrage:read`           | Kèo đang hiệu lực                                                                                                                                                                                                                             |
| GET    | `/arbitrage/stats`                                                                       | `arbitrage:read`           | Tổng quan: số room (`total`, `matched` ≥2 tenant, `withCombos`, `aboveMinMargin`), `byTenant` (số dòng, open/suspended, `newestAgeMs`), bộ đếm evaluator (`evaluations`, `roomsEvaluated`, `issued`/`refreshed`/`cancelled`), `activeSignals` |
| GET    | `/arbitrage/rooms?q=&tenant=&sport=&phase=&matched=&limit=&offset=`                      | `arbitrage:read`           | Danh sách room (id `room`, đội, tenant, `bestMargin`), sắp theo `bestMargin` giảm dần                                                                                                                                                         |
| GET    | `/arbitrage/rooms/{room}` ví dụ `/arbitrage/rooms/room:cs2:alliance~sinners:game-winner` | `arbitrage:read`           | Chi tiết room: odds từng tenant (parse + chuỗi gốc, `ageMs`), các tổ hợp + margin, kèo đang hiệu lực                                                                                                                                          |
| GET    | `/arbitrage/history?status=&phase=&room=&from=&to=&limit=50&offset=0`                    | `arbitrage:read`           | Lịch sử kèo đã phát (mới nhất trước)                                                                                                                                                                                                          |
| GET    | `/arbitrage/history/:signalId`                                                           | `arbitrage:read`           | Một kèo trong lịch sử                                                                                                                                                                                                                         |
| GET    | `/arbitrage/lanes`                                                                       | `arbitrage:read`           | Làn xử lý theo tenant × phase: `queued`, `processed`, `coalesced`, `busy`                                                                                                                                                                     |
| GET    | `/arbitrage/ingest`                                                                      | `arbitrage:read`           | Dữ liệu vào theo chặng, theo tenant × kind: `received`, `failed`, `skipped` (theo lý do), `set`/`remove`. Cộng dồn từ `since`; tốc độ = chênh lệch giữa hai lần lấy                                                                           |
| GET    | `/arbitrage/matches?q=&sport=&tenant=&phase=&matched=&limit=&offset=`                    | `arbitrage:read`           | Danh sách trận (gom mọi market của cùng cặp đội): `coverage` (tenant → số market), `matchedMarkets`, `bestMargin`                                                                                                                             |
| GET    | `/arbitrage/matches/{match}` ví dụ `/arbitrage/matches/cs2:alliance~sinners`             | `arbitrage:read`           | Ma trận market × tenant của một trận: `picks` (nhãn hai phía), dòng kèo từng tenant, số tổ hợp, `bestMargin`                                                                                                                                  |
| GET    | `/arbitrage/match-candidates?sport=&minScore=&limit=`                                    | `arbitrage:read`           | Cặp trận có thể bị ghép trượt (tên đội lệch) kèm `aliases` dùng thẳng cho `POST /team-aliases`                                                                                                                                                |
| GET    | `/arbitrage/settings`                                                                    | `arbitrage-settings:read`  | Cấu hình                                                                                                                                                                                                                                      |
| PATCH  | `/arbitrage/settings`                                                                    | `arbitrage-settings:write` | Sửa cấu hình (gửi trường cần đổi)                                                                                                                                                                                                             |

Cấu hình:

| Trường            | Mặc định              | Ý nghĩa                                                                                                       |
| ----------------- | --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `minMargin`       | `0.02`                | Ngưỡng lợi nhuận tối thiểu (2%). Dưới ngưỡng = hủy kèo                                                        |
| `marginStep`      | `0.01`                | Lời tăng thêm ≥ 1% → kèo mới ghi đè kèo cũ                                                                    |
| `signalTtlMs`     | `30000`               | Thời hạn kèo; còn nguyên thì phát lại                                                                         |
| `maxStartDriftMs` | `1200000`             | Hai chân chỉ ghép khi giờ bắt đầu lệch ≤ 20 phút                                                              |
| `enabledPhases`   | `["live","prematch"]` | Kênh được tạo kèo. Tắt một kênh → kèo đang sống của kênh đó bị hủy (`phase_disabled`), odds vẫn được cập nhật |

Kèo có bất kỳ chân nào live thì `phase = live`.
Cấu hình được lưu vào Postgres (bảng `app_settings`, key `arbitrage`) và tự nạp lại khi app khởi động.

### Lịch sử kèo

`status`: `active` (đang sống) · `superseded` (bị kèo mới hơn của cùng tổ hợp ghi đè, có `supersededBy`) · `cancelled` (có `statusReason`) · `abandoned` (app khởi động lại khi kèo còn sống, `statusReason = app_restart`).
Lịch sử được ghi nền, không làm chậm việc gửi kèo.

## Bí danh tên đội

| Method | Path                | Quyền                | Mô tả                                                                 |
| ------ | ------------------- | -------------------- | --------------------------------------------------------------------- |
| GET    | `/team-aliases`     | `team-aliases:read`  | Danh sách                                                             |
| POST   | `/team-aliases`     | `team-aliases:write` | `{ "alias": "NIP", "canonical": "Ninjas in Pyjamas" }` (tự chuẩn hóa) |
| DELETE | `/team-aliases/:id` | `team-aliases:write` | Xóa                                                                   |

Sau khi thêm/cập nhật/xóa bí danh, backend nạp lại bảng tên và chuyển các dòng đang chạy
sang room tương ứng, gỡ dòng ở khóa cũ rồi đánh giá lại kèo. Không cần restart publisher.
Giữ nguyên thời điểm cập nhật giá và URL gốc; nếu tên mới đảo thứ tự đội, odds/token và dấu handicap
được đảo cùng nhau. Cùng tên không đảm bảo phát kèo: vẫn cần cùng môn/market, odds mở,
giờ bắt đầu trong giới hạn, margin đạt ngưỡng và kênh được bật. Cả hai tên đội đều phải khớp.

## Consumer (bot giao dịch, Discord)

| Method | Path                    | Quyền               | Mô tả                                                                   |
| ------ | ----------------------- | ------------------- | ----------------------------------------------------------------------- |
| GET    | `/consumers`            | `consumers:read`    | Consumer đang/đã kết nối: online, tạm dừng, số frame chờ ack            |
| GET    | `/consumers/hub`        | `consumers:read`    | `activeSignals`, `pendingDeliveries`, danh sách kèo đang sống, consumer |
| POST   | `/consumers/:id/pause`  | `consumers:control` | Tạm dừng gửi kèo cho consumer                                           |
| POST   | `/consumers/:id/resume` | `consumers:control` | Tiếp tục                                                                |

### Kênh thông báo và hạng kèo

Admin tự đặt tên hạng kèo (vd "VIP" ≥ 5%, "Super VIP" ≥ 10%) và gắn hạng cho từng kênh Discord/Telegram/Slack.
Kênh nhận **kèo mới** (kể cả kèo ghi đè, ghi "Kèo cập nhật") và **tin hủy** của kèo nó đã nhận; không gửi lần phát lại (refreshed).
Kênh không chọn hạng nào = nhận mọi kèo. Một kèo có thể thuộc nhiều hạng (vd 12% thuộc cả VIP và Super VIP).
Bot giao dịch qua WebSocket không bị ảnh hưởng (vẫn nhận mọi kèo). Tất cả lưu trong Postgres, tự nạp khi khởi động.

| Method | Path                          | Quyền              | Mô tả                                                                                       |
| ------ | ----------------------------- | ------------------ | ------------------------------------------------------------------------------------------- |
| GET    | `/notify/tiers`               | `consumers:read`   | Hạng kèo, sắp theo `minMargin`                                                              |
| POST   | `/notify/tiers`               | `consumers:manage` | `{ "name": "VIP", "minMargin": 0.05, "maxMargin": null }` — kèo trong `[min, max)`; tên không trùng |
| PUT    | `/notify/tiers/:id`           | `consumers:manage` | Sửa hạng                                                                                    |
| DELETE | `/notify/tiers/:id`           | `consumers:manage` | Xóa hạng, gỡ khỏi mọi kênh                                                                  |
| GET    | `/notify/channels`            | `consumers:read`   | Kênh (bí mật đã che) + `status`: `sent`, `failed`, `queued`, `lastError`…                   |
| POST   | `/notify/channels`            | `consumers:manage` | Thêm kênh, xem ví dụ bên dưới                                                               |
| PUT    | `/notify/channels/:id`        | `consumers:manage` | Sửa kênh; bỏ trống `webhookUrl`/`botToken` = giữ giá trị cũ                                 |
| DELETE | `/notify/channels/:id`        | `consumers:manage` | Xóa kênh                                                                                    |
| POST   | `/notify/channels/:id/test`   | `consumers:manage` | Gửi tin kiểm tra ngay; lỗi → 400 kèm thông báo của nền tảng                                 |

```jsonc
{ "name": "Discord VIP", "enabled": true, "tierIds": ["<id hạng VIP>"],
  "config": { "type": "discord", "webhookUrl": "https://discord.com/api/webhooks/..." } }
{ "name": "Telegram", "tierIds": [],
  "config": { "type": "telegram", "botToken": "123456:ABC...", "chatId": "-1001234567890" } }
{ "name": "Slack", "config": { "type": "slack", "webhookUrl": "https://hooks.slack.com/services/..." } }
```

## Vận hành (admin)

| Method | Path                                                     | Quyền             | Mô tả                                                                                                                      |
| ------ | -------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`                                                | công khai         | Kiểm tra Dragonfly/Redis + Postgres ngay lúc gọi. 200 = ok, 503 = có phụ thuộc lỗi                                         |
| GET    | `/admin/snapshot`                                        | `admin:read`      | Toàn cảnh: sự cố đang mở, health, tasks, nodes, consumers, số liệu arbitrage, lanes, settings                              |
| GET    | `/admin/incidents?open=&kind=&limit=&offset=`            | `admin:read`      | `open=true` → sự cố đang mở; bỏ trống → lịch sử (mới nhất trước)                                                           |
| POST   | `/admin/incidents/{key}/ack`                             | `admin:incidents` | Xác nhận đã biết sự cố (vẫn mở tới khi hết thật)                                                                           |
| POST   | `/admin/ws-ticket`                                       | `admin:read`      | Vé dùng một lần, sống 60s, để trình duyệt mở admin stream: `{ ticket, expiresAt }`                                         |
| GET    | `/admin/audit?principalId=&method=&route=&from=&to=`     | `admin:read`      | Mọi request POST/PUT/PATCH/DELETE: ai, route, params/body (đã che bí mật), kết quả                                         |
| GET    | `/admin/odds-transitions?room=&tenant=&to=&from=&until=` | `admin:read`      | Dòng kèo xuất hiện (`from=null`), open↔suspended, bị gỡ (`to=removed` + reason). Giữ `ODDS_TRANSITION_RETENTION_DAYS` ngày |

### Sự cố (mức 1)

Watchdog kiểm tra mỗi 5 giây; mỗi sự cố có `key` ổn định nên chỉ mở **một lần** và báo khi **mở** và khi **hết**. Mở lại trong vòng 5 phút (chập chờn) thì ghi nhận nhưng không báo lại.

| kind               | key                                | Mức                         | Khi nào                                                                                  |
| ------------------ | ---------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| `task.failed`      | `task.failed:{taskId}`             | critical                    | Task hết lượt khởi động lại (FAILED)                                                     |
| `task.flapping`    | `task.flapping:{taskId}`           | warning                     | ≥ 3 lần lỗi liên tiếp                                                                    |
| `source.stale`     | `source.stale:{taskId}`            | critical                    | RUNNING nhưng không có dữ liệu quá ngưỡng: 5× `intervalMs` (≥ 30s); task stream: 15 phút |
| `node.down`        | `node.down:{nodeId}`               | critical                    | Node mất kết nối > 15s                                                                   |
| `infra.down`       | `infra.down:{dragonfly\|postgres}` | critical                    | Health check lỗi (kiểm tra mỗi 10s, timeout 3s)                                          |
| `consumer.down`    | `consumer.down:{consumerId}`       | critical (trader) / warning | Consumer mất kết nối > 30s                                                               |
| `consumer.backlog` | `consumer.backlog:{consumerId}`    | warning                     | ≥ 50 kèo chưa được ack                                                                   |
| `lane.backlog`     | `lane.backlog:{lane}`              | warning                     | ≥ 1000 cập nhật đang chờ trong làn                                                       |

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

| reason                 | Ý nghĩa                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `below_threshold`      | Lợi nhuận tụt dưới ngưỡng tối thiểu                                                                  |
| `leg_suspended`        | Một chân đang bị khóa odds                                                                           |
| `leg_removed`          | Odds của một chân bị gỡ (trận/market bị gỡ hoặc kết thúc)                                            |
| `start_time_mismatch`  | Giờ bắt đầu giữa hai bên lệch quá `maxStartDriftMs`                                                  |
| `publisher_stopped`    | Publisher cung cấp một chân đã chết hẳn hoặc bị dừng                                                 |
| `phase_disabled`       | Kênh (live/prematch) của kèo bị tắt                                                                  |
| `match_expired`        | Quá giờ bắt đầu + `MATCH_MAX_DURATION_HOURS` (mặc định 8 giờ) → trận coi như đã xong, dòng kèo bị gỡ |
| `missing_from_listing` | Market không còn trong danh sách của tenant 2 vòng quét liên tiếp (Polymarket)                       |

`signal.phase`: `live` | `prematch`. `signal.legs[i]`: `{ tenant, side, pick, odds, ref }`.

`signal.market` và ý nghĩa `side` (0 / 1):

| market                                         | side 0                              | side 1                    | `pick` ví dụ                         |
| ---------------------------------------------- | ----------------------------------- | ------------------------- | ------------------------------------ |
| `game-winner`                                  | `teams[0]` thắng                    | `teams[1]` thắng          | `"alliance"`                         |
| `map-handicap-m1.5`, `-m2.5`, `-p1.5`, `-p2.5` | `teams[0]` chấp (m = âm, p = dương) | `teams[1]` chấp ngược lại | `"alliance +1.5"` / `"sinners -1.5"` |
| `total-maps-2.5`, `-3.5`, `-4.5`               | over (tổng số map cả trận)          | under                     | `"over 2.5"` / `"under 2.5"`         |
| `map-1-winner` … `map-5-winner`                | `teams[0]` thắng map n              | `teams[1]` thắng map n    | `"alliance (map 1)"`                 |

`pick` chỉ để hiển thị; đặt lệnh theo `ref` + `side`. (Signal cũ trong lịch sử có `team` thay cho `pick`.)

`ref` là ID gốc để đặt lệnh:

- sptpub: `e` (eventId), `m` (marketId), `s` (specifier, vd `hcp=-1.5`, `total=2.5`), `o0`/`o1` (outcomeId của side 0 / side 1)
- polymarket: `c` (conditionId), `slug`, `t0`/`t1` (tokenId của side 0 / side 1)

`ref.url` (nếu có metadata): URL trang trận của tenant để mở trên trình duyệt.
CSGOEmpire dùng slug gốc của sport/category/tournament/event và ID trận từ feed;
Polymarket dùng slug event gốc, không phải slug market con. URL không thay thế ID dùng đặt lệnh.
Chi tiết room còn trả `picks: [side0, side1]` để hiển thị đúng nhãn kể cả khi chỉ có một tenant.

### Microservice publisher → app (`ws://<host>:${TASK_WS_PORT}`, mặc định 3001)

Dùng nội bộ bởi `pnpm start:task-runner`, xác thực bằng `TASK_WS_TOKEN`.

### Dashboard admin → app (`ws://<host>:${ADMIN_WS_PORT}`, mặc định 3003)

Xác thực bằng token trong `API_TOKENS` (cần quyền `admin:read`, vai trò `viewer` trở lên). Mỗi frame là một JSON.

```text
client → app
  { "type": "hello", "token": "<token>", "topics": ["alerts","tasks","nodes","consumers","metrics"] }   // bắt buộc trong 10s
  { "type": "hello", "ticket": "<vé từ POST /admin/ws-ticket>", "topics": [...] }   // cho trình duyệt
  { "type": "subscribe",   "topics": ["signals", "room:room:cs2:alliance~sinners:game-winner", "match:cs2:alliance~sinners"] }
  { "type": "unsubscribe", "topics": ["signals"] }
  { "type": "resync" }   // xin lại snapshot
  { "type": "ping" }

app → client
  { "type": "welcome", "principal": { "id", "roles" }, "topics": [...] }
  { "type": "snapshot", "data": <giống GET /admin/snapshot> }      // ngay sau welcome
  { "type": "event", "event": { "type", "topic", "at", "data" } }   // theo topic đã subscribe
  { "type": "metrics", "data": { evaluator, activeSignals, rooms, lanes, consumers, tasks, ingest } }  // mỗi ~2s
  { "type": "room", "room": "<id>", "data": <giống GET /arbitrage/rooms/{room}> }  // khi subscribe room
  { "type": "match", "match": "<id>", "data": <giống GET /arbitrage/matches/{match}> }  // khi subscribe trận
  { "type": "rejected", "reason" } | { "type": "error", "message" } | { "type": "pong" }
```

| Topic             | Sự kiện (`event.type`)                                                                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alerts`          | `incident.opened`, `incident.resolved`, `incident.acknowledged`                                                                                                                                             |
| `tasks`           | `task.state` (from → to, reason), `task.error`, `task.removed`                                                                                                                                              |
| `nodes`           | `node.connected`, `node.disconnected` (kèm task bị ảnh hưởng)                                                                                                                                               |
| `consumers`       | `consumer.connected`, `consumer.disconnected`                                                                                                                                                               |
| `signals`         | `signal.issued` (kèm `supersedes`), `signal.refreshed`, `signal.cancelled` (kèm `reason`)                                                                                                                   |
| `odds`            | `odds.transition`: xuất hiện / open↔suspended / bị gỡ                                                                                                                                                       |
| `odds` (tiếp)     | `odds.reset`: xóa sạch room lúc khởi động (`rooms`, `lines`, `reason`) · `odds.reconciled`: kết quả mỗi vòng đối chiếu danh sách market (`known`, `seen`, `pending`, `removed`, `held`, `ratio`, `massive`) |
| `audit`           | `audit.recorded`                                                                                                                                                                                            |
| `metrics`         | frame `metrics` định kỳ                                                                                                                                                                                     |
| `room:{roomId}`   | `odds.changed`: mọi thay đổi giá/trạng thái của đúng room đó (tối đa 20 room mỗi kết nối)                                                                                                                   |
| `match:{matchId}` | Ảnh chụp trận lúc subscribe, sau đó `odds.changed` của mọi room thuộc trận (tối đa 10 trận mỗi kết nối)                                                                                                     |

Không có topic stream toàn bộ odds: tần suất quá cao. Muốn xem odds thì subscribe từng room đang mở trên màn hình.

## Vòng đời dữ liệu (khi nào bị xóa)

| Dữ liệu                                        | Bị xóa khi                                                                                                                                                                                                                                                                                          | Xem ở đâu                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Dòng kèo (Redis Hash `room:*`, field = tenant) | Tenant báo gỡ (sptpub `null`; Polymarket `closed`/`acceptingOrders=false`/`market_resolved`) · trận vắng mặt trong snapshot sptpub · market vắng mặt 2 vòng quét Polymarket (`missing_from_listing`) · quá giờ trận (`match_expired`, kiểm tra mỗi phút) · publisher dừng hẳn (`publisher_stopped`) | topic `odds`, `room:`/`match:` (`removed: true`), `GET /admin/odds-transitions?to=removed` |
| Room                                           | Tự mất khi dòng cuối bị gỡ · **xóa sạch lúc khởi động** (`RESET_ROOMS_ON_START`, sự kiện `odds.reset`)                                                                                                                                                                                              | topic `odds`                                                                               |
| Kèo đang sống (RAM)                            | Bị hủy (xem bảng `reason`) hoặc bị kèo mới ghi đè · app khởi động lại → `abandoned`                                                                                                                                                                                                                 | topic `signals`, `/arbitrage/history`                                                      |
| Lịch sử kèo (Postgres)                         | Kèo đã kết thúc, phát quá `SIGNAL_HISTORY_RETENTION_DAYS` (90) ngày                                                                                                                                                                                                                                 | `/admin/snapshot` → `retention`                                                            |
| Sự cố (Postgres)                               | Đã đóng quá `INCIDENT_RETENTION_DAYS` (180) ngày                                                                                                                                                                                                                                                    | `/admin/snapshot` → `retention`                                                            |
| Audit (Postgres)                               | Quá `AUDIT_RETENTION_DAYS` (365) ngày                                                                                                                                                                                                                                                               | `/admin/snapshot` → `retention`                                                            |
| Chuyển trạng thái odds (Postgres)              | Quá `ODDS_TRANSITION_RETENTION_DAYS` (7) ngày                                                                                                                                                                                                                                                       | —                                                                                          |

Đối chiếu danh sách Polymarket: task `polymarket.descriptor` phát `cycle-start` → các trang `events` → `cycle-complete` (chỉ khi quét hết không lỗi). Vòng thiếu mốc đầu hoặc 0 trang → không đối chiếu. Nếu số market phải gỡ > 30% (và task sở hữu ≥ 10 market) → **giữ lại** tối đa 5 vòng và mở sự cố `odds.mass_removal` (kind) để người vận hành kiểm tra; vòng bình thường kế tiếp đóng sự cố.

Dọn Postgres chạy 1 phút sau khi khởi động rồi mỗi 24 giờ, mỗi bảng xóa theo lô 5.000 bản ghi (tối đa 200 lô/lần, còn thừa thì lần sau dọn tiếp). `GET /admin/snapshot` trả `retention: { policy, last }` với số bản ghi đã xóa và lỗi (nếu có) của từng bảng.

## Bảo mật kết nối

- Qua internet, mọi kênh phải đi qua reverse proxy TLS: REST `https://`, WebSocket `wss://` (`/admin-ws`, `/consumer-ws`, `/task-ws`). Cấu hình mẫu Caddy/Nginx và bảng bí mật từng kênh: [`deploy/README.md`](../deploy/README.md).
- `WS_BIND_HOST=127.0.0.1` để 3 cổng WebSocket chỉ nghe localhost sau proxy.
- Cả 3 kênh WebSocket: chưa gửi `hello` hợp lệ trong 10s → bị ngắt; token so sánh thời gian hằng; frame quá lớn → đóng mã `1009` (admin 64 KB, consumer 64 KB, publisher `TASK_WS_MAX_PAYLOAD_MB`, mặc định 64 MB).

## Quy ước chung

- **Danh sách có phân trang** (`/arbitrage/rooms`, `/arbitrage/matches`, `/arbitrage/history`, `/admin/incidents`, `/admin/audit`, `/admin/odds-transitions`) trả `{ "total": <số bản ghi khớp bộ lọc>, "items": [...] }`. `total` không phụ thuộc `limit`/`offset`.
- **Tham số ngày** (`from`, `to`, `until`) nhận Unix ms (`1791816000000`) hoặc ISO 8601 (`2026-10-12T15:00:00Z`); để trống = không lọc.
- **Input sai** (query/body không qua schema) → `400` `{ statusCode, error, message, issues: [{ path, message }] }`.
