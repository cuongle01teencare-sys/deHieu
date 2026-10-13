# Prompt thiết kế UI — Bảng điều khiển vận hành arbitrage

> Dán toàn bộ phần **PROMPT** bên dưới vào Figma Make (hoặc công cụ AI thiết kế khác).
> Nếu công cụ giới hạn độ dài, gửi lần lượt: Bối cảnh + Nguyên tắc + Bố cục chung trước, rồi từng màn hình.
> Dữ liệu mẫu trong prompt là dạng thật của API — giữ nguyên tên trường để lúc gắn code không phải đổi.

---

## PROMPT

### 1. Product context

Design an **operations console for desktop and mobile** for an esports odds-arbitrage system. It ships as one responsive web app that is also an **installable PWA**; on phones the admin installs it to the home screen and receives **push notifications (via OneSignal)** for critical events. The backend collects odds from several bookmakers/exchanges ("tenants", currently `sptpub` and `polymarket`, more later), normalizes them into **rooms** (one room = one match + one market), finds arbitrage opportunities between tenants, and sends **signals** to trading bots.

The single user type is an **admin who is both technician and operator**. They need to:
- See at a glance whether the whole pipeline is healthy (data coming in, being matched, signals going out).
- Trace data through every station: publisher task → tenant translator → room store → evaluator → signal → consumer (bot).
- Inspect one match across all its markets and all tenants side by side.
- Find matches that failed to pair between tenants (team-name mismatch) and fix them with a team alias.
- Act: start/stop publishers, pause consumers, acknowledge incidents, edit arbitrage settings, manage team aliases.
- **On the phone, away from the desk:** get a push notification when something needs attention, tap it, land on the right screen, understand the situation in seconds and take the urgent action (acknowledge an incident, pause a consumer, stop a publisher).

All UI text must be in **Vietnamese** (labels, buttons, empty states, tooltips). Team names, tenant ids, market ids and raw JSON stay as-is.

### 2. Design principles

- **Data-dense, calm, scannable.** This is a control room, not a marketing site. Tables, matrices, small multiples, sparklines. No hero images, no illustrations.
- **Dark theme by default**, with a light theme variant. Neutral greys; color only carries meaning.
- **Semantic colors** (define as tokens): `ok` (green), `warn` (amber), `critical` (red), `info` (blue), `muted`. Tenant colors: assign each tenant a distinct, color-blind-safe hue used consistently everywhere (chips, matrix columns, chart series). Never rely on color alone — pair with icon or text.
- **Numbers:** tabular/monospace figures, right-aligned. Odds with 2 decimals (`2.10`), margin as percent with 2 decimals (`+2.35%`, negative in muted red), ages as relative time (`3s`, `2m`, `1h`).
- **Liveness:** values updated by the realtime stream briefly highlight (subtle flash), and every live panel shows when it last updated. A global connection indicator shows stream state: connected / reconnecting / disconnected.
- **Staleness is a first-class state:** a value older than its expected refresh shows a "stale" style (dimmed + clock icon).
- **Progressive disclosure:** list → detail drawer → raw JSON (collapsible, copyable).
- **Permissions-aware:** actions the user lacks permission for are hidden or disabled with a tooltip explaining the missing permission (e.g. `tasks:manage`).
- Keyboard friendly: command palette (⌘K / Ctrl+K) to jump to a match, room, task or screen.

### 3. Global layout

- **Left sidebar** (collapsible to icons), grouped:
  - Tổng quan
  - Luồng dữ liệu (Ingest)
  - Trận đấu · Ghép trượt · Room
  - Kèo (live + lịch sử)
  - Publisher & Node · Consumer
  - Sự cố · Audit · Lịch sử odds
  - Cài đặt arbitrage · Bí danh đội
- **Top bar:** stream status pill, health badges (Redis, Postgres), open incidents counter (critical count in red), global search / command palette, current user + role, theme toggle.
- **Right drawer** pattern for details (room, signal, task) so the user never loses the list context.
- Widths: optimize for 1440–1920px; must remain usable at 1280px. Tablet (768–1024px) and **mobile (360–430px) are required** — see section 4.13 for the mobile layout.

### 4. Screens

#### 4.1 Tổng quan (Overview)
Source: snapshot + metrics frame (every ~2s).
- KPI row: active signals, rooms total / matched (≥2 tenants) / with combos / above min margin, evaluator issued / refreshed / cancelled, consumers connected / pending deliveries.
- Open incidents list (severity, title, since, acknowledge button).
- Publishers by state (RUNNING, RESTARTING, FAILED, STOPPED…) as a compact state bar.
- Per-tenant health cards: lines open / suspended, newest data age, messages/s (derived), parse failures/s.
- Lanes table (tenant × phase): queued, processed, coalesced, busy.

#### 4.2 Luồng dữ liệu (Ingest pipeline) — most important new screen
Purpose: "where does data drop?". Show a **left-to-right pipeline per tenant**:
`Publisher tasks (kinds) → Nhận (received) → Bỏ qua theo lý do (skipped by reason) | Lỗi (failed) → Thay đổi dòng kèo (set / remove) → Làn xử lý → Room → Kèo`.
- Each stage is a node with a live rate (per second, computed from successive snapshots) and a total since `since`.
- Edges are proportional (Sankey-like) so a drop is visually obvious.
- Below: table per `tenant × kind` with columns: received, rate/s, failed, set, remove, last received (age), last change (age), and a **stacked bar of skip reasons**. Clicking a reason shows its explanation.
- Skip reasons (show Vietnamese label + raw id): `parse_failed` (sai định dạng — có thể tenant đổi API), `unsupported_sport`, `invalid_event`, `unsupported_market`, `unsupported_line`, `missing_fields`, `same_team_names`, `no_moneyline_teams`, `unknown_asset`.
- Highlight rules: `parse_failed` rising → critical; no `received` for a running task → warn.

#### 4.3 Trận đấu (Matches list)
- Filters: search team, sport (cs2, lol), tenant, phase (live / prematch), "chỉ trận đã ghép".
- Columns: teams (with sport icon), start time (relative + absolute on hover), phase badges, **coverage** (one chip per tenant showing number of markets it has, e.g. `sptpub 13` `polymarket 6`), matched markets / total markets, best margin (colored if ≥ min margin).
- Row click → Match detail.

#### 4.4 Chi tiết trận (Match detail) — the signature view
A **matrix: rows = markets, columns = tenants**, grouped into sections:
- Thắng trận: `game-winner`
- Thắng từng map: `map-1-winner` … `map-5-winner`
- Chấp map: `map-handicap-m2.5`, `-m1.5`, `-p1.5`, `-p2.5`
- Tổng số map: `total-maps-2.5`, `-3.5`, `-4.5`
Each row shows its two **picks** (labels for side 0 and side 1), e.g. `alliance +1.5` / `sinners -1.5`, `over 2.5` / `under 2.5`.
Each cell (tenant) shows: odds for side 0 and side 1, status (open / suspended), phase (live / prematch), age; empty cell = tenant does not offer this market (show a subtle dash, not an error).
Row end: number of combos, best margin, "có kèo" badge if an active signal exists → opens the room drawer.
Header: teams, sport, start time, tenants, live indicator. Updates in realtime (cells flash on change).

#### 4.5 Room drawer
- Lines per tenant: parsed odds, status, phase, updatedAt/age, startsAt, `ref` (key-value), raw encoded string (monospace, copy).
- Combinations: two legs (tenant + pick + odds), margin, above-threshold flag.
- Active signals of the room.
- Timeline of odds transitions (appeared, open ↔ suspended, removed + reason).

#### 4.6 Ghép trượt (Match candidates)
- Each candidate is a card with two matches side by side (A from tenant X, B from tenant Y): teams, tenants, start times, start difference, **score** (0–1, as a meter).
- Team pairing lines between A and B with per-pair similarity.
- Suggested alias rows: `inf → infurity` with button **"Tạo bí danh"** (confirm dialog showing the effect), and "Bỏ qua".
- Filters: sport, min score.

#### 4.7 Kèo (Signals)
- Live feed (new on top): margin, phase, match + market, two legs as `tenant · pick @ odds`, expiry countdown. Cancelled signals animate out with the reason.
- History tab: status (active / superseded / cancelled / abandoned), reason, time range filters; detail drawer.

#### 4.8 Publisher & Node
- Tasks table: taskId, kind, tenant, node, state badge (state machine CREATED → … → RUNNING, RESTARTING, FAILED, STOPPED), restarts, last data age, last error (truncated, expandable).
- Actions: start new task (form generated from kind params), stop, delete stopped, send command.
- Nodes: connected/disconnected, tasks on node.

#### 4.9 Consumer
Connected bots/Discord: online, paused, pending acks; pause / resume.

#### 4.10 Sự cố, Audit, Lịch sử odds
Filterable tables with time range; incidents have severity, kind, opened/resolved, acknowledged by. Audit shows who / method / route / result.

#### 4.11 Cài đặt & Bí danh đội
- Arbitrage settings form: minMargin (%), marginStep (%), signalTtlMs (s), maxStartDriftMs (min), enabledPhases (live / prematch toggles). Show the effect of each field as helper text. Save with confirm + diff.
- Team aliases: table (alias → canonical), add, delete.

#### 4.12 Đăng nhập
Simple username + password page. No sign-up. Must also work as the first screen of the installed PWA on mobile.

#### 4.13 Mobile & PWA (required)
The phone is for **monitoring and urgent actions**, not for deep configuration. Design it as a native-feeling app, not a shrunk desktop.

**Mobile shell**
- Bottom tab bar (max 5): Tổng quan · Sự cố · Kèo · Trận đấu · Thêm (menu with the remaining screens).
- Compact top bar: screen title, stream status dot, notification bell with unread count.
- Respect safe areas (notch, home indicator); touch targets ≥ 44×44px; no hover-only information (tooltips become tap-to-reveal or bottom sheets).
- Drawers become full-height **bottom sheets**; wide tables become **card lists** (one card per row, key fields first, "Xem thêm" to expand).
- Pull-to-refresh on lists; sticky filter chips that open a filter bottom sheet.

**Mobile versions of the key screens**
- Tổng quan: stacked KPI cards, open incidents first, per-tenant health as compact rows with a status dot.
- Sự cố: list sorted by severity; swipe or button to **"Xác nhận"**; detail sheet with timeline.
- Kèo: live feed cards (match, market, margin, two legs `tenant · pick @ odds`, expiry countdown).
- Chi tiết trận: the market × tenant matrix becomes **one card per market** (picks as header, one row per tenant with the two odds, status and age, best margin at the bottom); sections collapsible (Thắng trận, Thắng từng map, Chấp map, Tổng số map).
- Luồng dữ liệu: vertical pipeline (stages stacked top to bottom) with rates; skip-reason breakdown as a horizontal bar per tenant.
- Publisher & Consumer: card lists with the urgent actions only (stop / restart publisher, pause / resume consumer) behind a confirm sheet.
- Settings, team aliases, audit: readable on mobile; editing may be desktop-only (show a hint "Chỉnh sửa trên máy tính").

**Push notifications (OneSignal) — design these flows**
- **Soft permission prompt** (our own screen/sheet before the browser's native prompt): explains what will be sent, with "Bật thông báo" / "Để sau". Do not trigger the native prompt on first load.
- **iOS hint:** on iPhone, push only works after "Thêm vào Màn hình chính" (iOS 16.4+). Design an install guide sheet with the Share → Add to Home Screen steps, shown when the app is opened in Safari but not installed.
- **Notification preferences** screen (per user): toggles per category with short descriptions —
  - Sự cố nghiêm trọng (critical incidents: publisher FAILED, node down, Redis/Postgres down) — on by default
  - Sự cố cảnh báo (warn incidents)
  - Kèo vượt ngưỡng (signal issued with margin ≥ a threshold the user sets, e.g. 3%)
  - Dữ liệu bất thường (parse failures rising, mass removal of odds lines)
  - Quiet hours (time range), and "chỉ khi có thao tác cần làm".
  Show subscription status: device list (this phone, other browsers), "Gửi thử thông báo" button.
- **Notification content templates** (title + body + deep link), e.g.:
  - `🔴 Publisher sptpub-live FAILED` / `Lỗi liên tiếp 5 lần — chạm để xem` → task detail
  - `Kèo +3.4% · cs2 alliance vs sinners` / `map-handicap-p1.5 · sptpub alliance +1.5 @ 1.75 | polymarket sinners -1.5 @ 2.40` → match detail
  - `Polymarket gỡ 42% market trong một vòng quét` / `Có thể do API lỗi — chạm để kiểm tra` → ingest screen
- **In-app notification center** (bell): list of received notifications, read/unread, tap → deep link; empty state.
- **Deep-link landing:** opening from a notification goes straight to the target screen with a highlighted item and a back button to Tổng quan, even on a cold start (show a branded loading state, then the target).

**PWA states**
- App icon set and splash screen (dark + light), short name "Arb Ops" (placeholder, keep it generic).
- Offline / no network: cached last snapshot shown as stale with a clear banner "Mất kết nối — dữ liệu lúc 10:42"; actions disabled.
- Stream reconnecting after the app returns from background: brief top banner, then data refresh.
- Update available: small toast "Có phiên bản mới — Tải lại".

### 5. Sample data (use these exact field names)

Match list item:
```json
{ "match": "cs2:alliance~sinners", "sport": "cs2", "teams": ["alliance", "sinners"],
  "tenants": ["polymarket", "sptpub"], "markets": 9, "matchedMarkets": 5,
  "coverage": { "sptpub": 9, "polymarket": 6 }, "phases": ["prematch"],
  "bestMargin": 0.0235, "aboveMinMargin": true,
  "startsAt": 1790326800000, "lastUpdatedAt": 1790320000000 }
```
Match detail market row:
```json
{ "market": "map-handicap-p1.5", "room": "room:cs2:alliance~sinners:map-handicap-p1.5",
  "picks": ["alliance +1.5", "sinners -1.5"],
  "lines": {
    "sptpub": { "odds": [1.75, 2.10], "status": "open", "phase": "prematch", "ageMs": 1200,
                "startsAt": 1790326800000, "ref": { "e": "2715093596264079406", "m": "327", "s": "hcp=-1.5", "o0": "1715", "o1": "1714" } },
    "polymarket": { "odds": [1.80, 2.05], "status": "suspended", "phase": "prematch", "ageMs": 45000,
                    "startsAt": 1790326800000, "ref": { "c": "0x3576…", "t0": "1018…", "t1": "4681…" } } },
  "combos": 2, "bestMargin": -0.012, "aboveMinMargin": false }
```
Ingest counter:
```json
{ "tenant": "sptpub", "kind": "sptpub.live", "received": 18234, "failed": 0,
  "set": 52110, "remove": 340,
  "skipped": { "unsupported_market": 120400, "unsupported_line": 2100, "unsupported_sport": 9000 },
  "lastReceivedAt": 1790320001000, "lastChangeAt": 1790320000500 }
```
Match candidate:
```json
{ "score": 0.9, "startsDiffMs": 300000,
  "a": { "match": "cs2:aaa~infurity", "teams": ["aaa", "infurity"], "tenants": ["sptpub"], "startsAt": 1790326800000 },
  "b": { "match": "cs2:aaa~inf", "teams": ["aaa", "inf"], "tenants": ["polymarket"], "startsAt": 1790327100000 },
  "pairs": [["aaa", "aaa"], ["infurity", "inf"]],
  "aliases": [{ "alias": "inf", "canonical": "infurity", "similarity": 0.8 }] }
```
Signal leg: `{ "tenant": "sptpub", "side": 0, "pick": "over 2.5", "odds": 2.2 }`.

### 6. States to design for every data view
Loading (skeletons), empty (explain why + next step), error (message + retry), stream disconnected (banner, data marked stale), offline (PWA), permission denied, very long team names (truncate with full name on tap/hover), 0 / 1 / many tenants (desktop matrix must scale to 4–5 tenant columns; mobile cards must stack any number of tenants).

### 7. Deliverables
- Frames for every screen above in dark and light themes at 1440px, plus the match detail at 1280px.
- **Mobile frames at 390×844** (dark + light) for: login, Tổng quan, Sự cố (list + detail), Kèo feed, Chi tiết trận, Luồng dữ liệu, Publisher list, notification permission soft prompt, iOS install guide, notification preferences, notification center, offline state. Plus a tablet frame (1024px) of Tổng quan and Chi tiết trận.
- Example push notifications rendered as they appear on iOS and Android lock screens.
- A component library with variants (each with desktop and mobile sizes where relevant: bottom tab bar, bottom sheet, card list item, notification item): status badge, tenant chip, odds cell (open / suspended / stale / empty / flashing), margin value, age value, KPI card, sparkline, pipeline node + edge, matrix row, drawer, data table (sortable, filterable, paginated), confirm dialog, toast, connection pill.
- Design tokens (colors, typography, spacing, radius) named semantically.
- If the tool exports code: **React + TypeScript + Tailwind CSS**, components compatible with **shadcn/ui** (Radix primitives), icons from **lucide-react**, charts with **Recharts**. Keep components presentational (props in, no data fetching inside). Responsive via Tailwind breakpoints in the same components (mobile-first classes), not separate mobile components, except where the pattern truly differs (table ↔ card list, drawer ↔ bottom sheet).
