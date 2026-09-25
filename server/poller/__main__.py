"""Docker CMD entry: python -m server.poller"""
import asyncio
import logging

from server.common.config import settings
from server.poller.loop import run_poller

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

if __name__ == "__main__":
    asyncio.run(run_poller())
