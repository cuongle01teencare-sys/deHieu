"""12-factor config: đọc từ env vars."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # DB
    database_url: str = "postgresql://dehieu:changeme@timescaledb:5432/dehieu"

    # sptpub polling — read-only public API, không cần auth (verified qua HAR).
    # Xem docs/platforms/csgoempire.md.
    sptpub_base: str = "https://api-h-c7818b61-608.sptpub.com"
    sptpub_brand_id: str = "2432911154364948480"   # brand csgoempire trên sptpub
    sptpub_user_agent: str = (
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
    # Flags bật/tắt loop — tạm thời có thể tập trung 1 loop khi debug hoặc
    # tiết kiệm tài nguyên. `poll_live_enabled=False` → live_loop KHÔNG start
    # (skip trong asyncio.gather). Không đụng descriptors_loop, prematch_loop,
    # status_loop.
    poll_live_enabled: bool = False
    poll_prematch_enabled: bool = True

    poll_live_seconds: float = 1.0            # score real-time
    poll_prematch_seconds: float = 30.0       # odds/schedule
    # Từ điển market descriptor + status labels — refresh chậm (không đổi thường).
    poll_descriptors_seconds: float = 3600.0
    # Per-event descriptions (players + market override) — chỉ fetch cho trận
    # có player-props markets. Mỗi trận refetch mỗi <interval>s.
    poll_event_descriptions_seconds: float = 300.0


    # ─── Polymarket WebSocket ingestor (Phase 2A) ───
    poly_ws_url: str = "wss://ws-subscriptions-frontend-clob.polymarket.com/ws/market"
    # Cứ N giây re-check subscription map từ DB; nếu đổi thì reconnect.
    poly_ws_refresh_seconds: int = 60
    # Batch flush interval (giây). Buffer > poly_ws_flush_max cũng flush.
    poly_ws_flush_seconds: float = 0.5
    poly_ws_flush_max: int = 100
    # Backoff khi WS lỗi.
    poly_ws_reconnect_backoff_seconds: int = 5
    # Flag bật/tắt WS ingestor.
    poly_ws_enabled: bool = True

    # ─── Polymarket poller ───
    # Interval giữa 2 lần fetch keyset. 60s là đủ nhẹ vì gamma-api CDN cache 300s.
    poly_poll_interval_seconds: float = 60.0
    # Cửa sổ prematch: fetch event có startTime trong [NOW, NOW + window_hours].
    poly_window_hours: int = 168   # 7 ngày
    # Số event tối đa 1 lần fetch (page size).
    poly_page_limit: int = 100
    # Bật/tắt polymarket poller (như POLL_PREMATCH_ENABLED cho sptpub).
    poly_poll_enabled: bool = True

    # ─── Arb detector (Phase 3) ───
    arb_poll_interval_seconds: float = 2.0
    # Freshness cho odds. Default 300s (5 phút) để cover prematch — sptpub chỉ
    # bump updated_at khi odds đổi thật, không bump per-cycle. Prematch odds
    # có thể đứng yên vài phút → nếu freshness quá chặt sẽ miss arb prematch.
    # Live-only setup: giảm xuống 15-30s.
    arb_freshness_seconds: int = 300
    arb_min_edge_improvement_pct: float = 0.5
    arb_enabled: bool = True

    # ─── Notifications (Discord for now) ───
    # URL webhook Discord (channel settings → Integrations → Webhooks →
    # Copy URL). Rỗng ⇒ tắt notify. Không log URL này ra stdout.
    discord_webhook_url: str = ""
    # Chỉ notify arb có edge >= threshold này (%). Default 0 = mọi arb mới.
    notify_min_edge_pct: float = 0.0

    # API
    api_host: str = "0.0.0.0"
    api_port: int = 8080
    log_level: str = "INFO"


settings = Settings()
