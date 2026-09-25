"""Client config — trỏ tới server."""
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
import yaml


@dataclass
class TLSConfig:
    ca_cert: str
    client_cert: str
    client_key: str
    verify_hostname: bool = True


@dataclass
class ServerConfig:
    base_url: str = "https://localhost:9443"        # REST base
    ws_url: str = "wss://localhost:9443/events"     # WebSocket stream
    tls: Optional[TLSConfig] = None


@dataclass
class AppConfig:
    server: ServerConfig = field(default_factory=ServerConfig)


def load_config(path: str) -> AppConfig:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(path)
    with p.open(encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    srv = raw.get("server", {})
    tls_raw = srv.get("tls")
    tls = TLSConfig(**tls_raw) if tls_raw else None
    server = ServerConfig(
        base_url=srv.get("base_url", "https://localhost:9443"),
        ws_url=srv.get("ws_url", "wss://localhost:9443/events"),
        tls=tls,
    )
    return AppConfig(server=server)
