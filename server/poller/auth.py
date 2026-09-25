"""
Auth flow cho CSGOEmpire → Betby/SportPub.

Dùng curl_cffi (impersonate Chrome TLS fingerprint) để bypass Cloudflare
Bot Management, vì httpx thuần dùng OpenSSL sẽ bị CF detect qua JA3/JA4.

Phase 1: user paste Cookie header vào env CSGO_COOKIE_HEADER.
Phase 2 (sau): tự login qua Chrome container để refresh cookie.
"""
import logging
from dataclasses import dataclass
from typing import Optional

import pyotp
from curl_cffi.requests import AsyncSession

from server.common.config import settings

log = logging.getLogger("poller.auth")

# Chrome version impersonate cho curl_cffi. Nên khớp với Chrome/Edge major
# version trong CSGO_USER_AGENT. Available: chrome99, chrome100, ..., chrome131, chrome136.
IMPERSONATE = "chrome131"


@dataclass
class BetbySession:
    jwt: str
    library_url: str
    brand_id: str


def _parse_cookie_header(header: str) -> dict:
    """`"a=1; b=2; c=x=y"` → {"a":"1","b":"2","c":"x=y"}"""
    header = header.strip()
    if len(header) >= 2 and header[0] == header[-1] and header[0] in ('"', "'"):
        header = header[1:-1]
    out = {}
    for part in header.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        k, v = part.split("=", 1)
        out[k.strip()] = v.strip()
    return out


class AuthClient:
    def __init__(self):
        # curl_cffi tự set UA + sec-ch-ua* + sec-fetch-* cho impersonate.
        # Custom headers cần thêm:
        common_headers = {
            "Origin": settings.csgo_base,
            "Referer": settings.csgo_base + "/match-betting",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "X-Env-Class": settings.csgo_env_class,
        }
        if settings.csgo_device_id:
            common_headers["X-Empire-Device-Identifier"] = settings.csgo_device_id
        self.csgo = AsyncSession(
            impersonate=IMPERSONATE,
            headers=common_headers,
            timeout=15,
        )
        self.sptpub: Optional[AsyncSession] = None
        self._betby: Optional[BetbySession] = None

    def _inject_auth(self) -> None:
        if not settings.csgo_cookie_header:
            raise RuntimeError(
                "CSGO_COOKIE_HEADER trống. Extract cookie từ browser session "
                "(F12 → Application → Cookies → csgoempire.com) và set vào server.env."
            )
        if not settings.csgo_device_id:
            raise RuntimeError(
                "CSGO_DEVICE_ID trống. Extract từ HAR: header `x-empire-device-identifier` "
                "hoặc query param `?uuid=...` trong request /api/v2/metadata. "
                "Ví dụ: ad615e93-1ede-4eb4-814d-83ae7b95994b"
            )
        jar = _parse_cookie_header(settings.csgo_cookie_header)
        for name, value in jar.items():
            self.csgo.cookies.set(name, value, domain=".csgoempire.com")
        log.info("Injected %d cookies: %s", len(jar), sorted(jar.keys()))
        log.info("TLS impersonate: %s | device_id: %s | env_class: %s",
                 IMPERSONATE, settings.csgo_device_id[:8] + "...", settings.csgo_env_class)

    async def get_security_token(self) -> dict:
        # QUAN TRỌNG: uuid trong body PHẢI khớp với x-empire-device-identifier
        if settings.csgo_totp_secret:
            # Compute TOTP code 6 số hiện tại từ secret (đổi mỗi 30s)
            otp = pyotp.TOTP(settings.csgo_totp_secret.replace(" ", "")).now()
        else:
            otp = "0000"  # placeholder khi account chưa bật 2FA
        # Backend đòi cả code và onetime_token
        payload = {
            "uuid": settings.csgo_device_id,
            "code": otp,
            "onetime_token": otp,
            "type": "standard",
        }
        r = await self.csgo.post(
            settings.csgo_base + "/api/v2/user/security/token",
            json=payload,
        )
        if r.status_code >= 400:
            log.error("=" * 60)
            log.error("HTTP %d from %s", r.status_code, r.url)
            log.error("Response headers: %s",
                      {k: v for k, v in r.headers.items()
                       if k.lower() in ("cf-ray", "cf-mitigated", "server",
                                        "content-type", "x-ratelimit-remaining")})
            log.error("Response body (first 500): %s", r.text[:500])
            log.error("=" * 60)
            raise RuntimeError(f"csgoempire trả {r.status_code}.")
        data = r.json()
        if not data.get("success"):
            raise RuntimeError(f"security_token failed: {data}")
        log.info("security_token OK (expires_in=%ss)", data.get("expires_in"))
        return data

    async def get_betby_session(self, security_token: str) -> dict:
        r = await self.csgo.post(
            settings.csgo_base + "/api/v2/match-betting/betby/user-session/en/EMP/EMP",
            json={"security_token": security_token},
        )
        if r.status_code >= 400:
            log.error("betby user-session HTTP %d: %s", r.status_code, r.text[:300])
            r.raise_for_status()
        data = r.json()
        if not data.get("success"):
            raise RuntimeError(f"betby user-session failed: {data}")
        log.info("betby JWT OK: %s...", data["data"]["token"][:40])
        return data

    async def identify_at_sptpub(self, jwt: str) -> int:
        self.sptpub = AsyncSession(
            impersonate=IMPERSONATE,
            headers={
                "Authorization": f"Bearer {jwt}",
                "Origin": settings.csgo_base,
                "Referer": settings.csgo_base + "/",
                "Accept": "application/json, text/plain, */*",
            },
            timeout=15,
        )
        r = await self.sptpub.post(
            f"{settings.sptpub_base}/api/v2/auth/brand/{settings.csgo_brand_id}/identify"
        )
        log.info("sptpub identify status=%d", r.status_code)
        return r.status_code

    async def bootstrap(self) -> BetbySession:
        self._inject_auth()
        sec_resp = await self.get_security_token()
        betby_resp = await self.get_betby_session(sec_resp["token"])
        jwt = betby_resp["data"]["token"]
        await self.identify_at_sptpub(jwt)
        self._betby = BetbySession(
            jwt=jwt,
            library_url=betby_resp["data"].get("libraryUrl", ""),
            brand_id=settings.csgo_brand_id,
        )
        return self._betby

    @property
    def betby(self) -> BetbySession:
        if not self._betby:
            raise RuntimeError("Chưa bootstrap()")
        return self._betby

    async def refresh_betby(self) -> BetbySession:
        if self._betby is None:
            raise RuntimeError("Chưa bootstrap() — gọi bootstrap() trước refresh_betby()")
        log.info("Refreshing betby JWT...")
        sec_resp = await self.get_security_token()
        betby_resp = await self.get_betby_session(sec_resp["token"])
        jwt = betby_resp["data"]["token"]
        if self.sptpub:
            self.sptpub.headers["Authorization"] = f"Bearer {jwt}"
        self._betby.jwt = jwt
        return self._betby

    async def close(self):
        await self.csgo.close()
        if self.sptpub:
            await self.sptpub.close()
