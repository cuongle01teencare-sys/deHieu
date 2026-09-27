"""
Cursor-based polling client cho api-h-*.sptpub.com (schema v4).

sptpub read-only endpoints là PUBLIC — không cần Authorization/Cookie/Bearer.
Đã verify qua HAR (samples/csgoempire.com.har): 363 request tới sptpub, 0
request nào carry auth headers. Chi tiết trong docs/platforms/csgoempire.md.

Chỉ cần: User-Agent giống browser + Origin/Referer trỏ về brand để qua CORS.
curl_cffi impersonate Chrome TLS fingerprint để tránh Cloudflare JA3/JA4
detection nếu bật lên (an toàn hơn dù chưa gặp).

Flow:
  1. Bootstrap: GET /api/v4/{kind}/brand/{brand}/en/0  -> index chứa
     `top_events_versions[0]` = version cursor cho lần data pull đầu tiên
  2. Data pull: GET /api/v4/{kind}/brand/{brand}/en/{cursor} -> full data
     với `events`, `sports`, `categories`, `tournaments`. Response's
     `version` field = cursor cho lần tiếp theo.
  3. Steady state: mỗi lần poll dùng cursor từ response trước.

Race-safe error logging: mỗi call `poll_live()` / `poll_prematch()` trả
kèm `snapshot` (request + response HAR-like) — caller nắm giữ, không phải
đọc từ shared instance attr (dễ bị loop khác overwrite).
"""
import logging
from typing import Optional, Tuple
from urllib.parse import urlparse

from curl_cffi.requests import AsyncSession

log = logging.getLogger("poller.sptpub")

# sptpub kiểm CORS Origin (không phải secret, chỉ header). Trỏ về brand mà
# brand_id thuộc về. Đổi khi chuyển sang brand khác trên cùng sptpub.
_ORIGIN_SPOOF = "https://csgoempire.com"

# curl_cffi impersonate: khớp Chrome major với UA để đồng bộ TLS fingerprint
# và client-hints. Available: chrome99..chrome136.
_IMPERSONATE = "chrome131"


def _platform_from_url(url: str) -> str:
    """Derive nhãn platform từ hostname của URL.
    'https://api-h-c7818b61-608.sptpub.com' -> 'sptpub'
    'https://csgoempire.com'                -> 'csgoempire'
    Lấy label ngay trước TLD cuối. KHÔNG xử lý compound TLD (.co.uk, .com.vn);
    nếu tương lai cần thì thay bằng tldextract."""
    host = (urlparse(url).hostname or "").lower()
    parts = [p for p in host.split(".") if p]
    if len(parts) < 2:
        return host or "unknown"
    return parts[-2]


def _empty_snapshot() -> dict:
    return {"request": None, "response": None}


class SptpubClient:
    def __init__(self, brand_id: str, base_url: str, user_agent: str):
        self.brand_id = brand_id
        self.base_url = base_url.rstrip("/")
        # Nhãn platform derive từ hostname -> dùng làm scope key trong schema `odds`.
        # Đổi base_url = đổi platform tự động, không cần env var tĩnh.
        self.platform = _platform_from_url(self.base_url)
        self.http = AsyncSession(
            impersonate=_IMPERSONATE,
            headers={
                "User-Agent": user_agent,
                "Origin": _ORIGIN_SPOOF,
                "Referer": _ORIGIN_SPOOF + "/",
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-US,en;q=0.9",
            },
            timeout=15,
        )
        self.last_version_live = 0
        self.last_version_prematch = 0

    async def close(self):
        await self.http.close()

    async def _get(self, path: str) -> Tuple[Optional[dict], dict]:
        """Trả (payload_json | None, snapshot).
        snapshot = {"request": {...}, "response": {...}}, dùng cho errlog."""
        url = self.base_url + path
        try:
            req_headers = dict(self.http.headers or {})
        except Exception:
            req_headers = {}
        snap: dict = {
            "request": {"method": "GET", "url": url, "headers": req_headers},
            "response": None,
        }
        try:
            r = await self.http.get(url)
            body_text = r.text
            snap["response"] = {
                "status": r.status_code,
                "headers": dict(r.headers or {}),
                "content_length": len(r.content),
                "body": body_text,  # full — errlog tự split ra file riêng
            }
            log.debug("GET %s -> %d (%d bytes)", path, r.status_code, len(r.content))
            if r.status_code >= 400:
                log.warning("GET %s -> %d: body[:300]=%s", path, r.status_code, body_text[:300])
                return None, snap
            try:
                return r.json(), snap
            except Exception as je:
                log.warning("JSON parse fail: %s | body[:200]=%s", je, body_text[:200])
                return None, snap
        except Exception as e:
            snap["response"] = {"status": None, "error": str(e)}
            log.warning("GET %s failed: %s", path, e)
            return None, snap

    def _extract_bootstrap_cursor(self, idx: dict) -> Optional[int]:
        top = idx.get("top_events_versions") or []
        rest = idx.get("rest_events_versions") or []
        all_v = [v for v in (top + rest) if isinstance(v, int)]
        return min(all_v) if all_v else None

    async def _poll(self, kind: str, cursor: int
                    ) -> Tuple[Optional[dict], Optional[int], dict]:
        """Poll 1 kind (live/prematch). Trả (payload, next_cursor, snapshot).

        Bootstrap: sptpub CHUNK response thành nhiều chunk (1 top + N rest).
        Phải chain-fetch tất cả cho tới khi `snapshot_complete: True`, MERGE
        events + dimensions của mọi chunk, rồi mới xong bootstrap. Nếu chỉ
        fetch 1 chunk như trước, bootstrap mất 3-4 phút (1 chunk/cycle) và
        mỗi lần restart poller lại phải bootstrap từ đầu.

        snapshot trả về là của chunk CUỐI (để errlog capture khi lỗi)."""
        path = f"/api/v4/{kind}/brand/{self.brand_id}/en/{cursor}"
        data, snap = await self._get(path)
        if not data:
            return None, None, snap

        # Bootstrap: response là INDEX (có top/rest_events_versions)
        if "top_events_versions" in data:
            boot_cursor = self._extract_bootstrap_cursor(data)
            if boot_cursor is None:
                log.info("[%s] index empty (no events yet)", kind)
                return data, None, snap
            top = data.get("top_events_versions") or []
            rest = data.get("rest_events_versions") or []
            log.info("[%s] bootstrap chain: %d top + %d rest chunks starting at %d",
                     kind, len(top), len(rest), boot_cursor)

            merged: dict = {}
            merged_events: dict = {}
            chunk_snap = snap
            current = boot_cursor
            max_chunks = 20  # safety cap: sptpub thực tế 6-10 chunk
            for i in range(max_chunks):
                chunk_data, chunk_snap = await self._get(
                    f"/api/v4/{kind}/brand/{self.brand_id}/en/{current}"
                )
                if not chunk_data:
                    log.warning("[%s] bootstrap chunk %d fetch failed at cursor %d",
                                kind, i, current)
                    return None, None, chunk_snap
                # Merge events (id -> event obj). Nếu trùng key, chunk sau override
                # (thực tế không trùng vì mỗi chunk giữ slice khác nhau).
                for eid, ev in (chunk_data.get("events") or {}).items():
                    merged_events[eid] = ev
                # Merge dimension dicts (sports/categories/tournaments) — union.
                # Chunk sau override giá trị cùng key (an toàn vì stable lookup).
                for dim in ("sports", "categories", "tournaments", "status"):
                    dim_data = chunk_data.get(dim)
                    if dim_data:
                        merged.setdefault(dim, {}).update(dim_data)
                # Metadata: giữ epoch/version/generated của chunk cuối cùng
                merged["epoch"] = chunk_data.get("epoch")
                merged["version"] = chunk_data.get("version", current)
                merged["generated"] = chunk_data.get("generated")
                merged["snapshot_complete"] = chunk_data.get("snapshot_complete")
                merged["fixtures_complete"] = chunk_data.get("fixtures_complete")

                next_v = chunk_data.get("version", current)
                if chunk_data.get("snapshot_complete"):
                    # Kết thúc bootstrap chain. next version jump sang delta space.
                    current = next_v
                    break
                current = next_v
            else:
                log.warning("[%s] bootstrap chain exceeded max_chunks=%d, giving up",
                            kind, max_chunks)

            merged["events"] = merged_events
            log.info("[%s] bootstrap complete: %d events merged, next_cursor=%d",
                     kind, len(merged_events), current)
            return merged, current, chunk_snap

        # Steady state
        next_cursor = data.get("version", cursor)
        return data, next_cursor, snap

    async def poll_live(self) -> Tuple[Optional[dict], dict]:
        data, next_cursor, snap = await self._poll("live", self.last_version_live)
        if next_cursor is not None:
            self.last_version_live = next_cursor
        return data, snap

    async def poll_prematch(self) -> Tuple[Optional[dict], dict]:
        data, next_cursor, snap = await self._poll("prematch", self.last_version_prematch)
        if next_cursor is not None:
            self.last_version_prematch = next_cursor
        return data, snap

    async def top_events(self, country: str = "VN", currency: str = "EMP") -> Optional[dict]:
        data, _snap = await self._get(
            f"/api/v1/top/events/{self.brand_id}/country/{country}/currency/{currency}/lang/en"
        )
        return data

    # ─────────────── DESCRIPTORS (từ điển) ───────────────
    # Ba endpoint tách khỏi luồng poll live/prematch — refresh chậm.

    async def fetch_market_descriptors(self) -> Optional[dict]:
        """Từ điển market chung (~2100 markets, ~650 KB). Refresh mỗi giờ."""
        data, _snap = await self._get(
            f"/api/v3/descriptions/brand/{self.brand_id}/markets/en"
        )
        return data

    async def fetch_statuses(self) -> Optional[dict]:
        """{code_str: label}. ~200 entries, 6 KB. Refresh mỗi giờ (không đổi thực)."""
        data, _snap = await self._get("/api/v1/descriptions/statuses/en")
        return data

    async def fetch_event_descriptions(self, event_id: str) -> Optional[dict]:
        """Per-event: players[] + markets{} với tên đã render (Graviti,
        First map - ..., v.v.). Chỉ fetch cho trận có player-props markets."""
        data, _snap = await self._get(
            f"/api/v3/descriptions/brand/{self.brand_id}/event/{event_id}/en"
        )
        return data
