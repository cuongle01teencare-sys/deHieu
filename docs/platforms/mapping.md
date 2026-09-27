# Mapping csgoempire ↔ polymarket — chiến lược ghép dữ liệu

> Đọc kèm `csgoempire.md` và `polymarket.md`. Tài liệu này trả lời: cho một
> trận cụ thể, làm sao ghép record bên sptpub với event bên polymarket, và
> làm sao ghép outcome "Team A wins" của hai nền tảng vào cùng một key để
> phát hiện chênh lệch tỉ giá.

Phạm vi giai đoạn hiện tại: **chỉ market Winner** (moneyline BO3/BO5 cho
CS2). Bỏ qua map winner, over/under, player props — có thể mở rộng sau.

---

## 1. Bối cảnh: hai vũ trụ ID khác nhau

| Chiều | csgoempire (qua sptpub) | polymarket |
|---|---|---|
| ID match | `event_id` (số nguyên, VD `2715306923066007564`) — internal sptpub | `event.id` (số, VD `1058981`) + `event.slug` (VD `cs2-pf2-mellre-2026-09-25`) |
| ID outcome | `market_id` + `specifier_key` + `outcome_id` (VD market=1, outcome=1/2/3) | `condition_id` (0x-hex 32-byte) + `clobTokenIds[i]` (uint256 lớn) + `outcome_index` (0/1) |
| Team | `competitors[0/1]` với `name` + `abbreviation` | `teams[]` với `name`, `abbreviation`, `providerId` (pandascore team id), `ordering: home/away` |
| Tournament | `tournaments{}` lookup theo `tournament_id` trong event | `series[].title` + `eventMetadata.league` + `eventMetadata.tournament` |
| Time | `desc.scheduled` — **unix seconds** | `event.startTime` — **ISO-8601 UTC string** |
| Sport | `sports{}` lookup — có id cho counter-strike | `sport.sport = "cs2"`, `sport.primaryTagId = 100780` |
| ID xuyên hệ | Không có trong HAR (không thấy pandascore/grid) | `eventMetadata.pandascoreMatchId` (int), `eventMetadata.gridSeriesId` (string), `teams[].providerId` (pandascore team id) |

**Vấn đề cốt lõi**: sptpub HAR **không lộ ra pandascore/grid ID** của trận,
trong khi polymarket **có sẵn cả hai**. Nghĩa là không thể exact-match qua
ID xuyên hệ ở stage này. Phải dùng **fuzzy match theo (team names, start
time, sport)**.

> **Cần verify khi có HAR mới**: liệu csgoempire.com có endpoint nào riêng
> (không qua sptpub) trả về pandascore/grid ID cho match không? Nếu có, đó
> là join key vàng và có thể bỏ fuzzy match. Cần chụp HAR khi mở trang chi
> tiết 1 match trên csgoempire.com để check.

---

## 2. Chiến lược ghép MATCH

Áp dụng theo thứ tự — dừng ở tầng đầu tiên hit.

### Tầng 1: exact-match qua provider ID (nếu tương lai có)

Nếu tương lai lấy được `pandascore_match_id` hoặc `grid_series_id` cho
match sptpub (qua endpoint khác, hoặc thêm nguồn thứ ba như pandascore
API), so trực tiếp với `eventMetadata.pandascoreMatchId` /
`eventMetadata.gridSeriesId` của poly. Confidence = 1.0.

### Tầng 2: exact team names + gần start time

Cần cả 4 điều kiện:

1. **Sport match**: sptpub sport = counter-strike (kiểm bằng lookup
   `sports[event.sport_id].name`); poly `sport.sport == "cs2"`.
2. **Team names normalize match**: normalize hai bên (lowercase, bỏ
   diacritics, bỏ ký tự không alphanumeric), so tập hợp
   `{home_norm, away_norm}` bằng nhau. Ordering có thể đảo vì poly gán
   `home/away` theo alphabet đôi khi, sptpub theo lịch thi đấu.
3. **Start time gần nhau**: `|sptpub.scheduled - unix(poly.startTime)| ≤ 30 phút`.
   (Có drift do reschedule; ngưỡng 30' đủ cho phần lớn trường hợp.)
4. **Chưa map với match khác** (unique constraint per (platform, match_id)).

Confidence = 0.95.

### Tầng 3: fuzzy team names + gần start time

Khi tên team viết khác nhau (VD `NAVI` vs `Natus Vincere`, `G2` vs
`G2 Esports`). Dùng Levenshtein hoặc Jaro-Winkler > 0.85 trên cặp team.

Confidence = 0.60–0.85 theo similarity score. Không auto-write khi < 0.85 —
đẩy vào `unmapped_events` để user duyệt tay.

### Tầng 4: manual

Có bảng con người assign qua CLI/UI. Confidence = 1.0, `method = 'manual'`.

---

## 3. Chiến lược ghép OUTCOME (chỉ Winner)

Ít phức tạp hơn vì market Winner là 2-way (không có Draw ở poly, mà ở
sptpub cho esports cũng thường 2-way — market_id `186` outcomes `4/5`).

### Bảng chuyển đổi Winner

| Nguồn | Market key | Outcomes |
|---|---|---|
| sptpub | `market_id=186` (2-way winner cho esports) | `outcome_id=4` = home; `outcome_id=5` = away |
| sptpub | `market_id=1` (1x2, chỉ khi sport có draw) | `outcome_id=1` = home; `outcome_id=2` = draw; `outcome_id=3` = away |
| poly | market với `sportsMarketType="moneyline"` (bỏ `child_moneyline` = map winner) | `outcome_index=0` = teams[0] (thường home); `outcome_index=1` = teams[1] (thường away) |

Canonical outcome key đơn giản cho Winner:

```
{canonical_match_id}:winner:home
{canonical_match_id}:winner:away
```

Chưa cần `:draw` vì CS2 không có. Nếu sau này thêm sport có draw thì extend.

### Ghép home/away hai bên

Poly gọi `teams[0]` = home theo `ordering: home`, nhưng đôi khi thứ tự
`outcomes` array có thể đảo. **Đừng tin vị trí — tin tên team**. Lookup
sptpub `competitors` để biết đội nào home, rồi so tên với poly `outcomes[i]`
string ("PsychoFace", "mellren") để quyết `outcome_index` nào là home.

---

## 4. Schema mapping table (đề xuất)

Đặt trong schema `odds`:

```sql
-- Ghép match_id giữa các nền tảng với canonical (= sptpub match_id)
CREATE TABLE odds.platform_match_map (
    platform            TEXT NOT NULL,   -- 'polymarket'
    platform_match_id   TEXT NOT NULL,   -- '1058981' (poly event.id) hoặc slug
    canonical_match_id  TEXT NOT NULL,   -- sptpub event_id, FK vào public.matches
    confidence          NUMERIC NOT NULL,-- 0..1
    method              TEXT NOT NULL,   -- 'exact_provider_id' | 'exact_name_time' |
                                          -- 'fuzzy_name_time' | 'manual'
    match_details       JSONB,           -- similarity scores, time diff, để audit
    verified_by         TEXT,            -- 'auto' hoặc username
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (platform, platform_match_id),
    UNIQUE (platform, canonical_match_id)   -- 1-1 trong phạm vi 1 platform
);

-- Ghép outcome giữa các nền tảng → canonical outcome key
CREATE TABLE odds.platform_outcome_map (
    platform              TEXT NOT NULL,
    platform_match_id     TEXT NOT NULL,
    platform_market_key   TEXT NOT NULL,   -- sptpub: 'market_id:specifier_key';
                                            -- poly: condition_id
    platform_outcome_id   TEXT NOT NULL,   -- sptpub outcome_id; poly outcome_index
    canonical_match_id    TEXT NOT NULL,
    canonical_outcome_key TEXT NOT NULL,   -- 'winner:home' / 'winner:away'
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (platform, platform_match_id, platform_market_key, platform_outcome_id),
    UNIQUE (platform, canonical_match_id, canonical_outcome_key)
);

-- Buffer những event poly gửi mà chưa map được match tương ứng
CREATE TABLE odds.unmapped_events (
    platform            TEXT NOT NULL,
    platform_match_id   TEXT NOT NULL,
    payload             JSONB NOT NULL,
    reason              TEXT,             -- 'no_sport_match', 'fuzzy_below_threshold', ...
    candidates          JSONB,            -- top 3 sptpub match_ids kèm score
    first_seen          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (platform, platform_match_id)
);
```

Sptpub KHÔNG cần row trong `platform_match_map` vì match_id của nó chính
là canonical — có thể có view giả tạo hoặc quy ước: khi query odds theo
canonical_match_id, sptpub row lấy trực tiếp bằng `match_id`.

---

## 5. Luồng đọc odds cho CLI (goal của giai đoạn này)

Input: slug dạng `<match_slug>-<match_id>` (VD `alliance-3dmax-2715306923066007564`).

```
1. Parse slug → tách match_id (regex \d{15,}$).
2. Query public.matches WHERE id = match_id → confirm tồn tại + lấy metadata.
3. Query odds.odds_current WHERE match_id = match_id AND platform = 'sptpub'
   → filter market_id IN (186, 1) → group by outcome_id.
4. Query odds.platform_match_map WHERE canonical_match_id = match_id AND
   platform = 'polymarket' → get poly's platform_match_id.
5. Nếu có row ở (4): query odds.odds_current WHERE match_id = <poly_id>
   AND platform = 'polymarket' → filter market có canonical_outcome_key
   'winner:*' (join odds.platform_outcome_map). Nếu không có: hiển thị
   "—" bên cột Polymarket.
6. Format bảng side-by-side với header teams/tournament/scheduled.
```

Bảng output mẫu:

```
Match:       Alliance vs 3DMax
Tournament:  ESL Pro League Season 21
Sport:       Counter-Strike 2 (Bo3)
Start:       2026-09-27 18:00 UTC (in 2h 14m)

                     csgoempire (sptpub)       polymarket
                     home     away              home     away
Match Winner         1.30     3.50              1.28     3.60
                     ─────    ─────             ─────    ─────
                     (updated_at deltas hiển thị nhỏ)
```

Cột nào không có mapping → in `—` và log warning một lần.

---

## 6. Định nghĩa "unmapped" và cách xử lý

Poly poller sẽ gặp nhiều event không có match sptpub tương ứng vì:

- Poly có sports/leagues csgoempire không cover (Valorant tier 2, chess).
- Poly niêm yết trước csgoempire.
- Team names quá lệch để fuzzy match qua ngưỡng.

Xử lý:

1. Poly poller vẫn ghi event vào `unmapped_events` (không ghi odds).
2. Job nền chạy mỗi 5 phút: retry match từng row trong `unmapped_events`
   (vì match_id sptpub có thể xuất hiện muộn hơn).
3. CLI/tool cho user duyệt thủ công `unmapped_events` cần review → confirm
   hoặc reject → row được promote vào `platform_match_map` với
   `method='manual'`.

---

## 7. Checklist implement (khi bắt tay code)

- [ ] Migration: 3 bảng mapping ở trên.
- [ ] Module `server/common/matching.py`: hàm `normalize_team_name`,
      `fuzzy_score`, `find_canonical_match(poly_event) -> (match_id, confidence, method)`.
- [ ] Poly poller viết vào `odds_current` với `platform='polymarket'`,
      `match_id` = canonical sptpub match_id (từ mapping lookup).
      Nếu không map được → ghi `unmapped_events` thay vì bỏ.
- [ ] Poly poller ghi 1 row vào `platform_outcome_map` cho mỗi outcome
      lần đầu thấy (idempotent qua ON CONFLICT DO NOTHING).
- [ ] CLI `odds <slug>` — implement bước 5 ở mục 5.
- [ ] Sanity check: 1 trận thật, chạy end-to-end, verify số hiển thị khớp
      với poly.com và csgoempire.com.

---

## 8. Điều chưa chắc / risk cần biết

1. **Team-name fuzzy có thể sai** với các trận nhỏ có team trùng tên loose
   (2 tournament song song có team tên "Nemesis" khác nhau). Mitigation:
   thêm điều kiện tournament similarity, hoặc lower confidence khi
   tournament không match.
2. **Reschedule > 30 phút** làm miss match. Có thể nới ngưỡng lên 4h nhưng
   sẽ tăng false positive.
3. **Poly's cached price** (`outcomePrices`) delay tới 300s so với thực tế
   order book. Đối với arb, PHẢI dùng WS `best_bid`/`best_ask` chứ không
   phải `outcomePrices`. Xem `polymarket.md` mục 6.
4. **Sport CS2** hôm nay được cover tốt cả hai bên; các sport khác (Dota,
   LoL) chưa test — có thể có edge case về tag_id / market_id khác.
