# Polymarket API — Sổ tay kỹ thuật

> Nguồn: reverse-engineer từ HAR `polymarket.com.har` (25/09/2026). Trọng tâm: đọc giá "Winner" cho các trận CS2 nhằm dò arbitrage với csgoempire.

---

## 1. Kiến trúc dữ liệu

Polymarket là **prediction market** chạy trên **Polygon blockchain** (mainnet). Mỗi thị trường (`market`) là một hợp đồng nhị phân YES/NO trên một mệnh đề (ví dụ: *"PsychoFace thắng mellren"*). Giá của outcome nằm trong `[0, 1]` và được diễn giải như **xác suất ngụ ý** của thị trường: giá 0.79 nghĩa là thị trường ước lượng ~79% khả năng xảy ra, tương đương odds decimal `1 / 0.79 ≈ 1.266`.

Các tầng hệ thống:

| Tầng | Mô tả |
|---|---|
| **Gamma API** (`gamma-api.polymarket.com`) | Metadata cho `event`, `market`, `series`, `tag`. Trả về giá gần nhất (`bestBid`, `bestAsk`, `outcomePrices`, `lastTradePrice`). Read-only, không cần auth cho public data. |
| **CLOB** (`clob.polymarket.com`) | Central Limit Order Book — sổ lệnh cho mỗi outcome token. REST + WebSocket. |
| **Data API** (`data-api.polymarket.com`) | Truy vấn lịch sử: trades, holders, positions. |
| **WebSocket market** (`wss://ws-subscriptions-frontend-clob.polymarket.com/ws/market`) | Cập nhật realtime order book & price changes cho danh sách `asset_id`. |
| **WebSocket live-data** (`wss://ws-live-data.polymarket.com/`) | Cập nhật activity (trades khớp) theo `event_slug`. |

Điểm quan trọng cho trận thể thao/esports: một **event** = một trận đấu (ví dụ `cs2-pf2-mellre-2026-09-25`), chứa **nhiều `market` con**, mỗi market là một hỏi/đáp nhị phân độc lập:
- `Match Winner` (moneyline BO3) — 2 outcome: Team A / Team B
- `Map 1 Winner`, `Map 2 Winner`, … (child_moneyline)
- `Games Total: O/U 2.5` (totals)

Không phải market 3-way (không có Draw) vì logic resolve của polymarket coi hòa/hủy = 50-50.

---

## 2. Hostnames & APIs quan sát được

Tần suất trong HAR (chỉ liệt kê domain liên quan tới market data):

```
9  GET  gamma-api.polymarket.com          # events/keyset, events/{id}, is-logged-in
1  GET  clob.polymarket.com               # /time (sync đồng hồ)
1  GET  data-api.polymarket.com           # /v2/trades
1  WS   ws-subscriptions-frontend-clob.polymarket.com/ws/market
1  WS   ws-live-data.polymarket.com/
1  GET  polymarket.com/api/esports/video-token   # JWT từ grid.gg, không phải market data
```

Các endpoint khác trên `polymarket.com/*` (`/api/geoblock/wallet-lists`, `/api/affiliate/*`, `/api/meta/capi`) là frontend/analytics, **không** dùng cho arbitrage.

Đáng chú ý: `eventMetadata.gridSeriesId` và `eventMetadata.pandascoreMatchId` là ID chéo tới nhà cung cấp esports data (grid.gg, pandascore). Có thể dùng để cross-reference với csgoempire nếu csgoempire cũng lộ một trong hai ID này.

---

## 3. Auth flow

**TL;DR: đọc dữ liệu market công khai KHÔNG cần auth, không cần ví, không cần ký EIP-712.**

Kiểm chứng từ HAR:

- `GET gamma-api.polymarket.com/events/1058981` — **không** có header `Authorization`, `Cookie`, `Poly-*`. Response 200 OK trả full metadata + giá.
- `GET gamma-api.polymarket.com/events/keyset?...` — chỉ có `Origin: https://polymarket.com` (browser tự thêm). Vẫn 200 OK.
- `GET data-api.polymarket.com/v2/trades?...` — chỉ headers chuẩn (`Accept`, `Referer`). 200 OK.
- `GET clob.polymarket.com/time` — 200 OK, trả timestamp thô `1790334413`.
- Cả hai WebSocket đều mở được từ browser với chỉ `Origin` header.

Endpoint duy nhất có auth cookie là `gamma-api.polymarket.com/is-logged-in` (trả `401 missing auth cookie` khi không có), nhưng **không** cần cho việc đọc giá — chỉ cho session của user đã kết nối ví.

**Auth khác biệt: đọc vs giao dịch**
- **Đọc** (mục đích của chúng ta): không auth. Chỉ cần `User-Agent` hợp lý và tôn trọng CORS `Origin: https://polymarket.com` nếu muốn.
- **Giao dịch** (đặt lệnh CLOB): cần ký EIP-712 bằng ví Polygon, POST với headers `POLY_ADDRESS`, `POLY_SIGNATURE`, `POLY_TIMESTAMP`, `POLY_NONCE`, `POLY_API_KEY`, `POLY_PASSPHRASE`. Không xuất hiện trong HAR này vì user chưa login.

**Rate limit headers**: không thấy header `X-RateLimit-*` hay `Retry-After` nào trong response. Chỉ có `cache-control: public, max-age=300` trên gamma và `cache-control: public, max-age=300` trên data-api. CloudFront/Cloudflare (`cf-cache-status`) là tầng cache chính.

**Kết luận**: có thể `curl` trực tiếp từ backend Python/Go mà không cần ví. Nên set `User-Agent` giống browser để tránh bị chặn thô, và tôn trọng cache 300s ở tầng CDN.

---

## 4. Các endpoint đọc market

### 4.1. `GET /events/keyset` — liệt kê event theo bộ lọc (paginated)

**Host**: `gamma-api.polymarket.com`

**Query params** (rút từ HAR):

| Param | Ví dụ | Ý nghĩa |
|---|---|---|
| `tag_id` | `100639`, `1`, `64`, `100780` | Lặp nhiều lần = AND filter. `1`=Sports, `64`=Esports, `100639`=Games, `100780`=counter-strike-2 |
| `active` | `true` | Chỉ event còn hoạt động |
| `closed` | `false` | Chưa đóng |
| `order` | `startTime` | Sắp xếp theo `startTime` / `endDate` / `volume` |
| `ascending` | `true` | |
| `limit` | `100` | Tối đa 100/trang |
| `live` | `true` | Chỉ đang live (optional) |
| `start_time_min` | `2026-09-25T10:06:48.922Z` | Cửa sổ thời gian ISO |
| `start_time_max` | `2026-09-26T11:06:48.922Z` | |
| `end_date_min` | `2026-09-25T11:06:48.927Z` | Chưa kết thúc |
| `after_cursor` | `G3KVZeHySTXOd...` | Base64 opaque cursor cho trang kế |

**Response**: `application/json`

```jsonc
{
  "$schema": "https://gamma-api.polymarket.com/schemas/EventsKeysetListResponse.json",
  "events": [
    {
      "id": "1058981",
      "ticker": "cs2-pf2-mellre-2026-09-25",
      "slug":   "cs2-pf2-mellre-2026-09-25",
      "title":  "Counter-Strike: PsychoFace vs mellren (BO3) - ...",
      "startDate": "2026-09-21T14:15:43Z",
      "endDate":   "2026-09-25T16:40:00Z",
      "active": true, "closed": false, "restricted": true,
      "liquidity": 14668.08, "volume": 31734.77,
      "enableOrderBook": true, "negRisk": false,
      "markets": [ /* … xem 4.2 … */ ],
      "tags": [{"id":"64","label":"Esports"}, {"id":"100780","label":"counter strike 2"}, ...],
      "series": [{"id":"10310","slug":"counter-strike","title":"Counter Strike"}],
      "startTime": "2026-09-25T10:40:00Z",
      "live": true, "ended": false,
      "score": "1-7|0-0|Bo3",
      "sport": {"id":37, "sport":"cs2", "name":"CS2", "primaryTagId":100780},
      "teams": [
        {"id":3293003,"name":"PsychoFace","abbreviation":"pf2","providerId":138537,"ordering":"home"},
        {"id":3280994,"name":"mellren","ordering":"away"}
      ],
      "eventMetadata": {
        "gridSeriesId": "2997988",
        "league": "European Pro League",
        "pandascoreMatchId": 1683298,
        "serie": "Series 9",
        "tournament": "Playoffs"
      }
    }
    // … tiếp theo
  ]
  // Cursor phân trang thu được từ URL bên trên (after_cursor). Response
  // không chứa field cursor tách bạch mà frontend tự tạo từ event cuối.
}
```

**Filter CS2 duy nhất**: `?tag_id=100780&active=true&closed=false&limit=100&order=startTime&ascending=true` (tag `counter-strike-2`).

**Cache**: `Cache-Control: public, max-age=300` (5 phút, qua Cloudflare).

**Tần suất polling từ site**: HAR cho thấy ~6 request keyset trong 1 lần load trang esports (~1s), sau đó **không** poll lại — realtime updates đi qua WebSocket.

### 4.2. `GET /events/{id}` — chi tiết 1 event

Ví dụ: `GET https://gamma-api.polymarket.com/events/1058981`

**Response** (rút gọn):

```jsonc
{
  "id": "1058981",
  "slug": "cs2-pf2-mellre-2026-09-25",
  "title": "Counter-Strike: PsychoFace vs mellren (BO3) - ...",
  "startDate": "...", "endDate": "...",
  "liquidity": 14668.08, "volume": 31734.77,
  "enableOrderBook": true,
  "markets": [
    {
      "id": "4794234",
      "question": "Counter-Strike: PsychoFace vs mellren (BO3) - ...",
      "conditionId": "0xeeac6925cb79b913b2e16ca930a5ca8f0647e927896f1d605687847dd58b6356",
      "slug": "cs2-pf2-mellre-2026-09-25",
      "outcomes":       "[\"PsychoFace\", \"mellren\"]",
      "outcomePrices":  "[\"0.21\", \"0.79\"]",
      "clobTokenIds":   "[\"7006188319628235...\", \"78698529292969281...\"]",
      "bestBid": 0.20, "bestAsk": 0.22, "spread": 0.02,
      "lastTradePrice": 0.21,
      "groupItemTitle": "Match Winner",
      "sportsMarketType": "moneyline",
      "gameId": "1683298",
      "gameStartTime": "2026-09-25 10:40:00+00",
      "enableOrderBook": true, "acceptingOrders": true,
      "orderPriceMinTickSize": 0.01, "orderMinSize": 5,
      "negRisk": false, "cyom": false
    },
    // … 3 markets khác: Map 1 Winner, Map 2 Winner, O/U 2.5 Games
  ],
  "score": "1-7|0-0|Bo3",     // score realtime nếu live
  "live": true, "ended": false
}
```

**Auth**: không. **Cache**: `max-age=300`.

Chú ý: `outcomes`, `outcomePrices`, `clobTokenIds` là **string JSON** (double-encoded), phải `json.loads` lần 2.

### 4.3. `GET /v2/trades` — trades gần đây

**Host**: `data-api.polymarket.com`

```
GET /v2/trades?condition=0xeeac...&taker_only=true&limit=10&filter_type=CASH&filter_amount=100
```

**Response**:

```jsonc
{
  "data": [
    {
      "proxy_wallet": "0x0cc3138207958914c03c995e2f06566267777021",
      "side": "BUY",
      "token_id": "78698529292969281385749331366028236498...",
      "condition_id": "0xeeac6925...",
      "size": 201.775,
      "price": 0.8,
      "timestamp": 1790334216,
      "title": "Counter-Strike: PsychoFace vs mellren (BO3) - ...",
      "slug":  "cs2-pf2-mellre-2026-09-25",
      "outcome": "mellren",
      "outcome_index": 1,
      "transaction_hash": "0xc8f6f4..."
    }
    // ...
  ]
}
```

Hữu ích để xem giá khớp gần nhất khi order book mỏng. Không auth.

### 4.4. `GET /time` — sync đồng hồ (CLOB)

`GET clob.polymarket.com/time` → `1790334413` (unix seconds, text/plain). Dùng để chống drift khi ký order (không cần cho read-only).

### 4.5. WebSocket `wss://ws-subscriptions-frontend-clob.polymarket.com/ws/market`

Realtime order book. Client mở connection rồi gửi 1 message subscribe:

```json
{
  "type": "markets",
  "assets_ids": [
    "18535583050565380249880538413809511225358079495756892847898930434265738794861",
    "66537244132594676281695851371817990074469045448277247953478295260255867835197",
    "..."
  ]
}
```

`assets_ids` là mảng `clobTokenIds` (mỗi outcome = 1 token). Server phản hồi:

**(a) Full book snapshot** (khi subscribe hoặc reset):

```jsonc
[
  {
    "market": "0xb33f13fd...",     // condition_id
    "asset_id": "67023712...",     // token_id
    "timestamp": "1790334414272",
    "hash": "5fdb596035...",
    "bids": [{"price":"0.01","size":"65133.76"}, {"price":"0.02","size":"41000"}, ...],
    "asks": [ /* ... */ ]
  }
]
```

**(b) Price change diff**:

```jsonc
{
  "market": "0x6b0f5fe5...",
  "price_changes": [
    {
      "asset_id": "70352610...",
      "price": "0.53",
      "size": "40",
      "side": "BUY",
      "hash": "c734f603...",
      "best_bid": "0.57",
      "best_ask": "0.59"
    }
  ],
  "timestamp": "1790334414586",
  "event_type": "price_change"
}
```

**Tần suất**: HAR ghi ~4390 message trong khoảng thời gian capture — cực dày, mỗi tick market là 1 message. Đây là kênh **duy nhất** để có giá realtime chính xác.

### 4.6. WebSocket `wss://ws-live-data.polymarket.com/`

Kênh activity (trades vừa khớp), subscribe theo `event_slug`:

```json
{
  "action": "subscribe",
  "subscriptions": [
    {"topic": "activity", "type": "orders_matched",
     "filters": "{\"event_slug\":\"cs2-pf2-mellre-2026-09-25\"}"},
    {"topic": "activity", "type": "orders_matched",
     "filters": "{\"event_slug\":\"cs2-mzp-optibe-2026-09-25\"}"}
    // ...
  ]
}
```

Không quan trọng cho arbitrage — chỉ dùng để hiển thị "trade feed" trên UI.

---

## 5. Mô hình khái niệm

| Thuật ngữ | Ý nghĩa |
|---|---|
| **event** | Container cho 1 sự kiện thực (1 trận đấu). Ví dụ `id=1058981`, `slug=cs2-pf2-mellre-2026-09-25`. |
| **market** | 1 câu hỏi nhị phân trong event. Có `id` (numeric), `slug`, `conditionId` (0x-hex). |
| **conditionId** | Hash 32-byte định danh market trên Polygon (contract-level ID). |
| **clobTokenIds** | Mảng 2 phần tử — 1 token cho mỗi outcome (YES/NO hoặc Team A/Team B). Token này là ERC-1155 trên Polygon. |
| **token_id / asset_id** | Cùng thứ, chỉ khác tên gọi API. Dùng để subscribe WebSocket order book. |
| **slug** | Chuỗi human-readable dùng làm URL: `polymarket.com/event/{slug}`. |
| **outcome / outcome_index** | Tên và index (0 hoặc 1) của bên. Index tương ứng vị trí trong `outcomes`/`outcomePrices`/`clobTokenIds`. |
| **price** | Xác suất ngụ ý ∈ [0, 1]. Odds decimal = 1/price (chưa trừ phí). |
| **sportsMarketType** | `moneyline` (main match), `child_moneyline` (map winner), `totals` (O/U), `spreads`. |

### Ví dụ thực tế: 1 trận CS2 trên Polymarket

Event `cs2-pf2-mellre-2026-09-25` (PsychoFace vs mellren, BO3, EPL S9 Playoffs) có **4 markets**:

| Market ID | question | outcomes | outcomePrices | sportsMarketType |
|---|---|---|---|---|
| 4794234 | *"…vs mellren (BO3)…"* (Match Winner) | `[PsychoFace, mellren]` | `[0.21, 0.79]` | `moneyline` ← **cái ta cần** |
| 4794231 | *"Map 1 Winner"* | `[PsychoFace, mellren]` | `[0.215, 0.785]` | `child_moneyline` |
| 4794233 | *"Map 2 Winner"* | `[PsychoFace, mellren]` | `[0.5, 0.5]` | `child_moneyline` |
| 4794236 | *"Games Total: O/U 2.5"* | `[Over, Under]` | `[0.5, 0.5]` | `totals` |

**Mapping với csgoempire**: 1 event Polymarket ≈ 1 match csgoempire. Không có Draw. Team names dùng đúng tên viết đầy đủ (không phải tag), nhưng có field `teams[].abbreviation` (`pf2` cho PsychoFace) và `teams[].providerId` (138537, có thể là pandascore team ID).

Để filter chỉ lấy market "Winner" của trận: `market.sportsMarketType == "moneyline"` **hoặc** `market.groupItemTitle == "Match Winner"`.

---

## 6. Trích giá cho arbitrage

Với 1 market (đã có `conditionId` + `clobTokenIds`), có **3 nguồn** giá theo mức độ realtime tăng dần:

### 6.1. REST cached (max-age 300s) — dễ nhất

Từ `GET /events/{id}` hoặc `GET /events/keyset`, mỗi market chứa sẵn:

```jsonc
{
  "outcomePrices": "[\"0.21\", \"0.79\"]",   // giá "mid" hiện tại
  "bestBid": 0.20,
  "bestAsk": 0.22,
  "spread": 0.02,
  "lastTradePrice": 0.21
}
```

- `outcomePrices[i]` ≈ mid-price cho outcome `i` (dùng để hiển thị trên card).
- `bestBid` / `bestAsk` = top-of-book cho outcome **index 0**. Nếu muốn giá outcome index 1 = `1 − bestAsk` (giá YES + giá NO = 1 vì đây là market bù trừ).
- Giá hiển thị trên site polymarket.com trên card list **là `outcomePrices[i]`**. Trên trang chi tiết market thì là `bestBid` (khi bấm Sell) hoặc `bestAsk` (khi bấm Buy).

Cache CDN 5 phút, vì vậy poll thường xuyên hơn cũng không có ích. **Đủ cho arbitrage nếu chấp nhận độ trễ ≤ 5s** — nhưng thực tế site poll `/events/keyset` chỉ 1 lần rồi giữ, delta đi qua WS.

### 6.2. WebSocket order book — realtime

Subscribe `wss://ws-subscriptions-frontend-clob.polymarket.com/ws/market` với `clobTokenIds`. Mỗi price_change gồm `best_bid`, `best_ask` mới nhất. Đây là kênh **frontend polymarket.com dùng thật** để cập nhật price ticker.

**Khuyên dùng cho poller arbitrage**: mở 1 WS, subscribe hàng loạt `assets_ids` của tất cả CS2 matches đang live, xử lý diff.

### 6.3. Trade tape

`GET /v2/trades?condition={cid}&limit=1` → giá + size trade cuối. Dùng để sanity check.

**Công thức odds**:

```
price_yes    = clamp( outcomePrices[i], 0.01, 0.99 )
implied_prob = price_yes
odds_decimal = 1.0 / price_yes           # chưa trừ phí
                                          # (Polymarket maker/taker fee thường 0 với sports;
                                          #  makerBaseFee=1000, takerBaseFee=1000 ở đơn vị bps hay basis
                                          #  points, xem field `makerBaseFee` trong market object)
```

Chú ý spread có thể rất rộng khi market ít lỏng (bestBid=0.04 / bestAsk=0.39 trên Map 2 Winner khi chưa ai đặt). Dùng `outcomePrices` hoặc `lastTradePrice` làm fallback, không phải midpoint của book rỗng.

---

## 7. Rate limit & polling cadence

- **Không thấy** header `X-RateLimit-*`, `Retry-After` hay tương tự trong bất kỳ response nào.
- Response có `Cache-Control: public, max-age=300` (Cloudflare cache hit cho gamma-api).
- Site poll `/events/keyset` **6 lần** trong 1 lần load `/esports` (mỗi lần với filter khác: `live=true` + không live + cursor tiếp theo), sau đó **không** poll lại. Cập nhật realtime chạy hoàn toàn qua 2 WebSocket.
- CLOB `/time` được gọi 1 lần khi load — chỉ để lấy server timestamp.

**Đề xuất cho poller**:
1. **Bootstrap**: `GET /events/keyset?tag_id=100780&active=true&closed=false&order=startTime&ascending=true&limit=100` để lấy list CS2 events + toàn bộ markets + clobTokenIds. Refresh mỗi 60–120s để bắt event mới.
2. **Realtime**: mở WS `/ws/market`, subscribe tất cả `clobTokenIds` của market `sportsMarketType=moneyline`. Xử lý `price_change` để cập nhật `best_bid` / `best_ask` in-memory.
3. **Health-check**: nếu WS không có message trong 60s, gọi lại `GET /events/{id}` để lấy `bestBid`/`bestAsk` snapshot.

Với ~50 trận CS2 đang live × 2 token/match = ~100 `asset_id` subscribe — dư sức trong 1 WS connection.

---

## 8. Điểm chưa rõ / cần kiểm chứng

- **Pagination**: `after_cursor` là base64 opaque, decode ra là `{"v":1,"k":"events","oh":"...","keys":[{"t":"time","v":"..."},{"t":"string","v":"1075254"}]}`. Không thấy `next_cursor` trả về trong response — frontend tự tạo từ event cuối. Cần thử endpoint để xem có field nào chứa cursor tiếp theo hay không (khả năng cao là có nhưng bị bỏ qua trong HAR do trang chỉ load ít event).
- **Endpoint danh sách token IDs độc lập**: HAR không có `GET /markets` hay `GET /prices` từ CLOB REST — mọi price đều được nhét sẵn trong response gamma. Nếu cần fetch giá 1 token đơn lẻ mà không qua event, có thể thử `GET clob.polymarket.com/book?token_id=...` (không thấy trong HAR, cần thử ngoài).
- **`polymarket.com/api/esports/video-token`**: trả JWT của `grid.gg` để stream video match — **không** liên quan market data, nhưng field `gridSeriesId` trong `eventMetadata` xác nhận Polymarket đồng bộ với grid.gg cho lịch trận. Nếu csgoempire cũng dùng grid, có thể match trực tiếp qua `gridSeriesId`.
- **`gamma-api.polymarket.com/is-logged-in`**: cần cookie session, không dùng cho read.

---

## 9. Tóm tắt cheat sheet

```bash
# 1) Liệt kê tất cả trận CS2 đang chờ + đang live
curl 'https://gamma-api.polymarket.com/events/keyset?\
tag_id=100780&active=true&closed=false&\
order=startTime&ascending=true&limit=100'

# 2) Chi tiết + giá của 1 trận
curl 'https://gamma-api.polymarket.com/events/1058981'

# 3) Trade tape cho 1 market
curl 'https://data-api.polymarket.com/v2/trades?\
condition=0xeeac6925cb79b913b2e16ca930a5ca8f0647e927896f1d605687847dd58b6356&\
taker_only=true&limit=10'

# 4) Realtime (browser)
new WebSocket('wss://ws-subscriptions-frontend-clob.polymarket.com/ws/market')
  .send(JSON.stringify({type:'markets', assets_ids:['7006...','78698...']}))
```

Không cần API key, không cần ký EIP-712 cho việc đọc.
