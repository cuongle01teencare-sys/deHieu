"""
Cursor-based polling client cho api-h-*.sptpub.com (schema v4 mới).

Flow:
  1. Bootstrap: GET /api/v4/live/brand/{brand}/en/0  → index chứa
     `top_events_versions[0]` = version cursor cho lần data pull đầu tiên
  2. Data pull: GET /api/v4/live/brand/{brand}/en/{cursor} → full data
     với `events`, `sports`, `categories`, `tournaments`. Response's
     `version` field = cursor cho lần tiếp theo.
  3. Steady state: mỗi lần poll dùng cursor từ response trước.

Logic tương tự cho prematch.

Race-safe error logging: mỗi call `poll_live()` / `poll_prematch()` trả
kèm `snapshot` (request + response HAR-like) — caller nắm giữ, không phải
đọc từ shared instance attr (dễ bị loop khác overwrite).
"""
import logging
from typing import Optional, Tuple

log = logging.getLogger("poller.sptpub")


def _empty_snapshot() -> dict:
    return {"request": None, "response": None}


class SptpubClient:
    def __init__(self, http, brand_id: str, base_url: str):
        self.http = http                     # curl_cffi.requests.AsyncSession
        self.brand_id = brand_id
        self.base_url = base_url.rstrip("/")
        self.last_version_live = 0
        self.last_version_prematch = 0

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
            log.debug("GET %s → %d (%d bytes)", path, r.status_code, len(r.content))
            if r.status_code >= 400:
                log.warning("GET %s → %d: body[:300]=%s", path, r.status_code, body_text[:300])
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
        snapshot là của call CUỐI (nếu bootstrap 2-step thì là data pull, không phải index)."""
        path = f"/api/v4/{kind}/brand/{self.brand_id}/en/{cursor}"
        data, snap = await self._get(path)
        if not data:
            return None, None, snap

        # Bootstrap: response là INDEX → cần pull data lần 2
        if "top_events_versions" in data:
            boot_cursor = self._extract_bootstrap_cursor(data)
            if boot_cursor is None:
                log.info("[%s] index empty (no events yet)", kind)
                return data, None, snap
            log.info("[%s] bootstrap: cursor 0 → %d", kind, boot_cursor)
            path2 = f"/api/v4/{kind}/brand/{self.brand_id}/en/{boot_cursor}"
            data2, snap2 = await self._get(path2)
            if not data2:
                return None, None, snap2
            next_cursor = data2.get("version", boot_cursor)
            return data2, next_cursor, snap2

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
