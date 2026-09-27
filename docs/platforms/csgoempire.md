# csgoempire (sptpub) — Winner market

Tài liệu này mô tả luồng dữ liệu odds "Winner" (1x2 / 2-way match winner)
mà csgoempire.com đang phục vụ cho FE. Chỉ tập trung phần cần cho arbitrage
với polymarket; bỏ qua player props, handicap, over/under, bet builder.

Nguồn: HAR `samples/csgoempire.com.har` (630 entries; 363 tới sptpub;
brand `2432911154364948480`).

---

## 1. Kiến trúc dữ liệu

csgoempire.com chỉ là frontend (React SPA served từ `csgoempire.com`,
route `/match-betting`). Toàn bộ dữ liệu sportsbook — sports, tournaments,
events, markets, odds, statuses — đến từ **sptpub** (nhà cung cấp phần mềm
BetBy/BT-Renderer), host `api-h-c7818b61-608.sptpub.com`. Mọi endpoint
sptpub được scope theo `brand_id = 2432911154364948480` (định danh cố định
của csgoempire trong hệ thống sptpub). Client giữ đồng bộ bằng cơ chế
**cursor/version**: mỗi response trả về `epoch` (session snapshot) và
`version` (monotonic counter); client polling long-poll URL
`.../en/{last_version}` để nhận delta kể từ version đó; khi `epoch` đổi
nghĩa là snapshot bị xoay và client phải bắt đầu lại từ cursor `0`. Song
song, một WebSocket `wss://api-h-c7818b61-608.sptpub.com/api/v1/ws_new`
dùng cho các sự kiện phía user (bet slip, balance) — không cần cho việc
đọc odds. Cursor cho live poll và prematch poll độc lập nhau.

---

## 2. Auth flow

Điểm quan trọng: **các endpoint đọc odds trên sptpub KHÔNG yêu cầu
auth**. Không có cookie, không có Bearer, không có `x-empire-device-identifier`
trên request tới `api-h-c7818b61-608.sptpub.com`. Chỉ cần đúng `Origin:
https://csgoempire.com` (do CORS) và User-Agent hợp lệ. Xác nhận từ HAR:
242/242 request live-poll không mang header `cookie` hay `authorization`.

Các header duy nhất cần khi gọi sptpub read-only:

```
:authority: api-h-c7818b61-608.sptpub.com
accept: */*
accept-encoding: gzip, deflate, br, zstd
accept-language: en-US,en;q=0.9
origin: https://csgoempire.com
referer: https://csgoempire.com/
user-agent: <UA Chrome/Edge bất kỳ>
```

**Auth chỉ cần khi đặt cược / dùng WebSocket user-session.** Luồng:

1. FE gọi `POST https://csgoempire.com/api/v2/match-betting/betby/user-session/en/EMP/EMP`
   với header `x-empire-device-identifier: <uuid>` và `x-env-class: green`
   (cùng cookie phiên đăng nhập csgoempire — bị trình duyệt strip khỏi HAR
   vì HttpOnly).
2. Response trả JWT do sptpub ký (`alg: ES256`, `iss = brand_id`, `sub =
   sptpub player_id`, TTL ~30 phút):

   ```json
   {
     "success": true,
     "data": {
       "token": "eyJ0eXAiOiJKV1Qi...",
       "libraryUrl": "https://csgoempire.sptpub.com/bt-renderer.min.js"
     }
   }
   ```
3. Client dùng JWT để `handshake` trên `wss://.../api/v1/ws_new?brand_id=...&lang=en`:
   ```json
   {"action":"handshake","payload":{"token":"eyJ..."}}
   ```
   Server trả `{"action":"handshake_success","payload":{"player_id":...}}`.
4. Sau khi có `player_id`, gọi `GET /api/v2/auth/brand/{brand}/identify`
   để lấy cấu hình player (currency, min bet, sports enabled).

Với poller arbitrage (chỉ đọc odds) → **bỏ qua toàn bộ mục 2**, không
cần login csgoempire.

---

## 3. Endpoints dùng cho polling

Tất cả path đều có prefix `https://api-h-c7818b61-608.sptpub.com`, và
`{brand}` = `2432911154364948480`.

| Endpoint | Freq | Mục đích |
|---|---|---|
| `GET /api/v4/live/brand/{brand}/en/{cursor}` | ~1 req/s | Delta odds/markets cho events đang LIVE |
| `GET /api/v4/prematch/brand/{brand}/en/{cursor}` | ~1 req/5s | Delta odds/markets cho events PRE-MATCH |
| `GET /api/v3/descriptions/brand/{brand}/markets/en` | 1 lần | Dictionary `market_id -> {name}` |
| `GET /api/v1/descriptions/statuses/en` | 1 lần | Dictionary `status_id -> label` (0=Not started, 1=1st period, ...) |
| `GET /api/v1/auth_side/brand/{brand}/{cursor}` | ~2s | Đếm số event mỗi provider — chỉ để hiển thị sidebar count, không có odds |
| `GET /api/v2/auth/brand/{brand}/identify` | 1 lần | Cấu hình player (chỉ khi có JWT) |

**Cursor semantics** (đã verify từ 8 request liên tiếp):

```
cursor=0                epoch=1789679853329 version=1790318265534 events=0     # bootstrap ack
cursor=0                epoch=1789679853329 version=1790318265534 events=0     # duplicate retry
cursor=1790318265534    epoch=1789679853329 version=1790318265535 events=183   # snapshot
cursor=1790318265535    epoch=1789679853329 version=3580636336333 events=26    # delta
cursor=3580636336333    epoch=1789679853329 version=3580636342334 events=22    # delta
...
```

Luật gọi:
- Lần đầu → `cursor = 0`. Response có `snapshot_complete: true|false` và
  `events` = full state.
- Các lần sau → `cursor = response.version` của lần trước.
- Nếu `response.epoch` khác lần trước → reset về `cursor = 0`.

Response luôn có `epoch`, `version`, `generated` (server ms). Long-poll
tự block ~1s server-side nếu chưa có delta mới.

---

## 4. Response shape: live/prematch payload

Top-level keys (giống nhau giữa `/v4/live/*` và `/v4/prematch/*`):

```json
{
  "epoch": 1789679853329,
  "version": 1790318265535,
  "generated": 1790318266395,
  "snapshot_complete": false,
  "fixtures_complete": true,
  "status": { "<provider_hash>": <count>, "...": ... },
  "strict_providers": [],
  "sports":      { "<sport_id>":      { "name": "...", "slug": "...", "priority": 0 } },
  "categories":  { "<category_id>":   { "sport_id": "...", "name": "...", "slug": "...", "country_code": "..." } },
  "tournaments": { "<tournament_id>": { "category_id": "...", "name": "...", "slug": "...", "tier": "A" } },
  "events":      { "<event_id>":      { "desc": {...}, "markets": {...}, "state": {...}, "score": {...} } }
}
```

Chi tiết một `event` (ví dụ rút gọn, sport 20 — table tennis):

```json
{
  "2715058995911069723": {
    "desc": {
      "scheduled": 1790318400,
      "type": "match",
      "slug": "kurilenko-oleg-kuzmenko-dmitry",
      "sport": "20",
      "category": "1669819...",
      "tournament": "2318063...",
      "competitors": [
        { "id": "2369571299921104940", "name": "Kurilenko, Oleg", "sport_id": "20" },
        { "id": "2369578722056613917", "name": "Kuzmenko, Dmitry", "sport_id": "20" }
      ]
      # player_props, bet_builder, stage: bỏ
    },
    "markets": {
      "186": {                        # market_id = "Winner" (2-way)
        "": {                         # specifier rỗng cho winner chính
          "4": { "k": "1.35" },       # outcome 4 = home
          "5": { "k": "2.95" }        # outcome 5 = away
        }
      }
      # các market khác (handicap, totals, ...): bỏ
    },
    "state":  { "provider": "35b93b7a", "status": 1, "match_status": 502 },
    "score":  { "home_score": "0", "away_score": "0", "period_scores": [] }
  }
}
```

Chú ý:
- `sports`/`categories`/`tournaments` là **lookup tables** — id ở
  `event.desc.{sport,category,tournament}` reference vào đây. Trong response
  delta chúng CÓ THỂ vắng mặt, phải cache từ snapshot đầu.
- Trong delta, một `event` có thể xuất hiện chỉ với vài field bị đổi (VD
  chỉ `markets.186` mới) — client cần merge chứ không replace.
- `k` là hệ số **decimal odds** ở dạng string.
- `competitors[0]` = home, `competitors[1]` = away (nhất quán trong mọi
  event kiểm tra).

---

## 5. Winner market extraction

### 5.1 Market IDs

Cross-reference với `/api/v3/descriptions/brand/{brand}/markets/en`
(response là `dict[market_id] = { "id": "...", "name": "..." }`):

| market_id | name | outcomes | Dùng cho |
|-----------|------|----------|----------|
| `1`   | `1x2`                        | 3-way: `1`=home, `2`=draw, `3`=away | Bóng đá, các môn có hoà |
| `186` | `Winner`                     | 2-way: `4`=home, `5`=away | Tennis, bóng rổ (không OT), esports, ping pong |
| `219` | `Winner (incl. overtime)`    | 2-way: `4`=home, `5`=away | Bóng rổ có OT, hockey |
| `340` | `Winner (incl. super over)`  | 2-way: `4`=home, `5`=away | Cricket |
| `60`  | `1st half - 1x2`             | 3-way `1/2/3` | KHÔNG dùng cho arb full-match |
| `11`  | `Draw no bet`                | 2-way `4/5`   | Bỏ (không tương đương moneyline) |

**Chọn winner market theo priority**: `1` (nếu có) → `186` → `219` →
`340`. Trong sample có event bóng đá dùng `1`, tennis dùng `186`, cricket
dùng `340`.

### 5.2 Outcome mapping đã verify bằng data

Xác nhận từ 5 event khác nhau trong HAR:

- Boxing (Alvarez vs Richards, `market 1`):
  ```
  competitors[0] = Alvarez (favorite thực tế)
  outcomes: {"1": 1.15, "2": 20.0, "3": 4.7}
  => 1 = home = Alvarez  ✓
  ```
- Table tennis (`market 186`):
  ```
  competitors: [Kurilenko, Kuzmenko]
  outcomes: {"4": 1.35, "5": 2.95}
  => 4 = home, 5 = away
  ```
- Kabaddi (`market 60`, half-1 1x2): `{1: 2.4, 2: 13.0, 3: 1.72}` — cùng
  convention 1/2/3 = home/draw/away.

### 5.3 Extraction pseudocode

```python
def extract_winner(event):
    markets = event.get("markets", {})
    for mid in ("1", "186", "219", "340"):
        m = markets.get(mid)
        if not m: continue
        # winner chính luôn nằm ở specifier rỗng ""
        outcomes = m.get("")
        if not outcomes: continue
        if mid == "1":
            return {
                "home": float(outcomes["1"]["k"]),
                "draw": float(outcomes["2"]["k"]),
                "away": float(outcomes["3"]["k"]),
                "market_id": mid,
            }
        else:
            return {
                "home": float(outcomes["4"]["k"]),
                "away": float(outcomes["5"]["k"]),
                "market_id": mid,
            }
    return None
```

Lưu ý: cùng một event có thể xuất hiện `market 186` VÀ `market 219`. Ưu
tiên `219` (incl. OT) cho các môn có overtime để khớp với poly resolver
"who wins the game including OT". Ngược lại `186` (không OT) hợp với các
môn không có OT như tennis.

---

## 6. Match identity

Key chính từ sptpub: **`event_id`** (string, snowflake 19 chữ số, ví dụ
`2715058995911069723`). Ổn định trong suốt vòng đời event.

Các key phụ để mapping cross-platform (khi poly chỉ có tên đội):

| Field | Path | Ghi chú |
|-------|------|---------|
| `event_id`           | key trong `events{}`                     | Primary key sptpub |
| `slug`               | `event.desc.slug`                        | VD `alvarez-saul--richards-lerrone-` — không luôn khớp poly slug |
| `home_name`          | `event.desc.competitors[0].name`         | Có unicode markers `⁽ᵉ⁾` cho esports team, cần strip |
| `away_name`          | `event.desc.competitors[1].name`         | Tương tự |
| `home_id` / `away_id`| `event.desc.competitors[*].id`           | ID nội bộ sptpub, không dùng chung với poly |
| `start_time_utc`     | `event.desc.scheduled` (unix seconds)    | ⚠ **seconds**, không phải ms |
| `tournament_name`    | `tournaments[event.desc.tournament].name`| VD `Valhalla League 2026 Week #39` |
| `tournament_slug`    | `tournaments[event.desc.tournament].slug`| |
| `sport_name`         | `sports[event.desc.sport].name`          | VD `Kabaddi`, `Table tennis`, `Boxing` |
| `sport_slug`         | `sports[event.desc.sport].slug`          | |
| `category_name`      | `categories[event.desc.category].name`   | Quốc gia / khu vực |
| `status`             | `event.state.status`                     | Lookup qua `descriptions/statuses/en` |

**Vé chuẩn hoá gợi ý cho arb layer:**

```python
{
  "provider": "csgoempire",
  "event_id": "2715058995911069723",
  "sport": "Table tennis",
  "tournament": "TT Cup Cyprus, Men",
  "start_utc": 1790318400,
  "home": "Kurilenko, Oleg",
  "away": "Kuzmenko, Dmitry",
  "odds": {"home": 1.35, "away": 2.95},
  "market_id": "186",
  "version": 1790318265535   # để dedup delta
}
```

**URL FE csgoempire cho một match**: không tồn tại per-event URL. Route
public duy nhất là `https://csgoempire.com/match-betting`; điều hướng đến
event cụ thể diễn ra client-side trong iframe của BT-Renderer (sptpub SDK)
và không được reflect lên URL bar top-level trong HAR. Nếu cần deeplink,
phải xét URL bên trong iframe `csgoempire.sptpub.com` (không có sample
trong HAR này).
