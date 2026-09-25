"""Xây SSL context cho mTLS 1.3 (client side)."""
import ssl
from typing import Optional
from client.config import TLSConfig


def build_ssl_context(tls: Optional[TLSConfig]) -> Optional[ssl.SSLContext]:
    if not tls:
        return None
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_3
    ctx.check_hostname = tls.verify_hostname
    ctx.verify_mode = ssl.CERT_REQUIRED
    ctx.load_verify_locations(cafile=tls.ca_cert)
    ctx.load_cert_chain(certfile=tls.client_cert, keyfile=tls.client_key)
    return ctx
