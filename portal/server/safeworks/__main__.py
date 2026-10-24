"""Run the server:  python -m safeworks   (reads PORT, HOST, WEB_CONCURRENCY, TRUST_PROXY, LOG_LEVEL)."""
import os

import uvicorn

from .config import config


def main() -> None:
    workers = int(os.environ.get("WEB_CONCURRENCY", "1"))
    print(f"SafeWorks Portal listening on http://{config.host}:{config.port} ({workers} worker{'s' if workers != 1 else ''})", flush=True)
    uvicorn.run(
        "safeworks.app:app",
        host=config.host,
        port=config.port,
        workers=workers,
        proxy_headers=config.trust_proxy,
        forwarded_allow_ips="*" if config.trust_proxy else None,
        log_level=config.log_level,
        access_log=config.log_level in ("info", "debug"),
        timeout_keep_alive=65,
        server_header=False,
    )


if __name__ == "__main__":
    main()
