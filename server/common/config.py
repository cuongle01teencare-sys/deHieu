"""12-factor config: đọc từ env vars."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # DB
    database_url: str = "postgresql://dehieu:changeme@timescaledb:5432/dehieu"

    # Redis
    redis_url: str = "redis://redis:6379/0"

    # Poller auth — phase 1: dán Cookie header value copy từ browser
    # Extract: F12 → Network → 1 request tới csgoempire.com/api → phải chuột → Copy → Copy as cURL
    # → tách phần `-H "cookie: ..."` → paste vào CSGO_COOKIE_HEADER
    csgo_cookie_header: str = ""              # "name1=v1; name2=v2; ..."
    csgo_bearer_token: str = ""               # dự phòng, hiện chưa dùng

    # Device identifier — extract từ HAR: header `x-empire-device-identifier`
    # Cùng giá trị với query `?uuid=...` trong /api/v2/metadata
    csgo_device_id: str = ""                  # ví dụ: "ad615e93-1ede-4eb4-814d-83ae7b95994b"
    csgo_env_class: str = "green"             # x-env-class header

    # TOTP secret (base32) lấy khi setup 2FA. Poller tự compute code 6 số mỗi 30s.
    # Để trống nếu account chưa bật 2FA (poller sẽ gửi "0000" placeholder).
    csgo_totp_secret: str = ""

    csgo_base: str = "https://csgoempire.com"
    csgo_brand_id: str = "2432911154364948480"
    sptpub_base: str = "https://api-h-c7818b61-608.sptpub.com"
    csgo_user_agent: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0"
    )

    def model_post_init(self, __context) -> None:
        """Strip enclosing quotes trong string fields (defensive vs format: raw)."""
        for name, val in self.__dict__.items():
            if isinstance(val, str) and len(val) >= 2:
                if val[0] == val[-1] and val[0] in ('"', "'"):
                    object.__setattr__(self, name, val[1:-1])

    # Poller loops (chạy song song, interval riêng)
    poll_live_seconds: float = 1.0            # score real-time
    poll_prematch_seconds: float = 30.0       # odds/schedule

    # API
    api_host: str = "0.0.0.0"
    api_port: int = 8080
    log_level: str = "INFO"


settings = Settings()
