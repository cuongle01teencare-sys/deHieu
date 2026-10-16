"""Own one SeleniumBase Chrome until the Node parent's stdin closes.

stdout is a JSON readiness protocol; SeleniumBase diagnostics go to stderr.
Only descendants of this helper are reaped. The persistent profile is retained.
"""

import argparse
import asyncio
import contextlib
import json
import os
import signal
import sys
import threading
from urllib.parse import urlsplit

import psutil


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--binary")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("Invalid CDP port")

    protocol = sys.stdout
    owner = psutil.Process()
    stopping = threading.Event()
    finished = threading.Event()
    descendants = {}
    descendants_lock = threading.Lock()

    def remember_children():
        with contextlib.suppress(psutil.Error):
            children = owner.children(recursive=True)
            with descendants_lock:
                descendants.update((child.pid, child) for child in children)

    def reap_children():
        remember_children()
        with descendants_lock:
            children = list(descendants.values())
        for child in reversed(children):
            with contextlib.suppress(psutil.Error):
                child.terminate()
        _, alive = psutil.wait_procs(children, timeout=1)
        for child in alive:
            with contextlib.suppress(psutil.Error):
                child.kill()
        psutil.wait_procs(alive, timeout=1)

    def shutdown_deadline():
        if not finished.wait(5):
            reap_children()
            os._exit(1)  # Driver startup/quit can block; bound its lifetime.

    def request_stop(*_):
        if not stopping.is_set():
            stopping.set()
            threading.Thread(target=shutdown_deadline, daemon=True).start()

    def watch_parent():
        # EOF also arrives on a Node crash or SIGKILL, without a shutdown RPC.
        for _ in sys.stdin:
            pass
        request_stop()

    threading.Thread(target=watch_parent, daemon=True).start()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, request_stop)

    driver = None
    with contextlib.redirect_stdout(sys.stderr):
        try:
            from seleniumbase import sb_cdp

            if stopping.is_set():
                return
            # Use SeleniumBase's Playwright integration: launch Chrome through
            # CDP directly, without creating a Selenium/ChromeDriver session.
            driver = sb_cdp.Chrome(
                headless=args.headless,
                user_data_dir=os.path.abspath(args.profile),
                browser_executable_path=args.binary,
                host="127.0.0.1",
                port=args.port or None,
                browser_args=[
                    "--disable-save-password-bubble",
                    "--disable-features=PasswordManagerOnboarding,PasswordLeakDetection",
                ],
            )
            remember_children()
            endpoint = urlsplit(driver.get_endpoint_url())
            if endpoint.hostname != "127.0.0.1" or not endpoint.port:
                raise RuntimeError("CDP must listen on loopback")
            if args.port and endpoint.port != args.port:
                raise RuntimeError("Chrome did not use the requested CDP port")
            if not stopping.is_set():
                print(json.dumps({"endpoint": f"http://127.0.0.1:{endpoint.port}"}),
                      file=protocol, flush=True)
            while not stopping.wait(0.5):
                remember_children()
                # Pump Python's CDP loop so subprocess exit and connection events
                # are processed while Playwright controls Chrome from Node.
                driver.loop.run_until_complete(asyncio.sleep(0))
                if driver.driver.stopped:
                    break
        finally:
            request_stop()
            remember_children()
            if driver is not None:
                with contextlib.suppress(Exception):
                    driver.quit()
            reap_children()
            finished.set()


if __name__ == "__main__":
    main()
