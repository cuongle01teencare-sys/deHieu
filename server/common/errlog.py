"""Error dump scaffold: mỗi exception → 1 file JSON riêng, gom theo ngày.

Cấu trúc: LOG_ROOT/errors/YYYY-MM-DD/HH-MM-SS-<ms>_<kind>.json

Nội dung file:
    - timestamp (ISO, local tz)
    - kind (phân loại lỗi do caller đặt, ví dụ "live_loop", "prematch_loop")
    - exception (type, message, full traceback)
    - request  (HAR-like: method, url, headers, cursor... — do caller cung cấp)
    - response (HAR-like: status, headers, body preview — do caller cung cấp)
    - extra   (dict tuỳ ý — payload snippet, iter number, ...)

Đây là SCAFFOLD. Sau này upgrade sang structured logger (Sentry, Loki, ELK)
chỉ cần thay hàm dump() — interface caller không đổi.
"""
import json
import logging
import os
import traceback
from datetime import datetime
from pathlib import Path
from typing import Optional

log = logging.getLogger("errlog")

# Root path — override qua env LOG_ROOT nếu cần (ví dụ test local).
# Trong Docker: /app/logs (bind mount từ ../logs của host).
LOG_ROOT = Path(os.environ.get("LOG_ROOT", "/app/logs"))


def _slug(s: str) -> str:
    """Sanitize chuỗi để dùng làm phần filename."""
    out = "".join(c if c.isalnum() or c in "-_" else "_" for c in s)
    return out[:40] or "unknown"


# Nếu response body vượt ngưỡng này (chars), tách ra file .body.json riêng
# và trong file exception chỉ giữ preview + reference.
BODY_INLINE_LIMIT = 4096


def dump(
    kind: str,
    exc: BaseException,
    *,
    request: Optional[dict] = None,
    response: Optional[dict] = None,
    extra: Optional[dict] = None,
) -> Optional[Path]:
    """Ghi 1 file lỗi. Không raise nếu ghi fail (chỉ log).

    Nếu response['body'] lớn hơn BODY_INLINE_LIMIT, tách ra file sibling
    `<stamp>_<kind>.body.json` và trong record chính chỉ giữ:
        response.body_file: "<basename>"
        response.body_size: <chars>
        response.body_preview: "<first 500>"
    Còn response['body'] gốc bị pop.

    Args:
        kind: nhãn phân loại, ví dụ "live_loop", "prematch_loop", "auth_refresh".
        exc:  exception object.
        request:  {method, url, headers, ...} — thông tin HTTP request.
        response: {status, headers, content_length, body, ...} — HTTP response.
                  Field 'body' nếu có sẽ được auto tách nếu lớn.
        extra:    dict context tuỳ ý (iteration, cursor, ...).
    """
    try:
        now = datetime.now()
        day_dir = LOG_ROOT / "errors" / now.strftime("%Y-%m-%d")
        day_dir.mkdir(parents=True, exist_ok=True)

        stamp = now.strftime("%H-%M-%S-") + f"{now.microsecond // 1000:03d}"
        base_name = f"{stamp}_{_slug(kind)}"
        path = day_dir / f"{base_name}.json"
        body_path = day_dir / f"{base_name}.body.json"

        # Deep-ish copy response để không mutate caller's dict.
        resp_out: Optional[dict] = None
        if response is not None:
            resp_out = dict(response)
            body = resp_out.pop("body", None)
            if isinstance(body, str) and len(body) > BODY_INLINE_LIMIT:
                # Tách ra file riêng
                try:
                    body_path.write_text(body, encoding="utf-8")
                    resp_out["body_file"] = body_path.name
                    resp_out["body_size"] = len(body)
                    resp_out["body_preview"] = body[:500]
                except Exception as e:
                    resp_out["body_write_error"] = str(e)
                    resp_out["body_preview"] = body[:500]
            elif isinstance(body, str):
                # Đủ nhỏ, inline
                resp_out["body"] = body

        record = {
            "timestamp": now.isoformat(timespec="milliseconds"),
            "kind": kind,
            "exception": {
                "type": exc.__class__.__name__,
                "module": exc.__class__.__module__,
                "message": str(exc),
                "traceback": "".join(
                    traceback.format_exception(type(exc), exc, exc.__traceback__)
                ),
            },
            "request": request,
            "response": resp_out,
            "extra": extra,
        }

        path.write_text(
            json.dumps(record, ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
        log.warning("error dumped [%s] → %s", kind, path)
        return path
    except Exception as e:
        log.error("errlog.dump failed for kind=%s: %s", kind, e)
        return None
