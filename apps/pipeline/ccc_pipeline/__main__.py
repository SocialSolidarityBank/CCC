"""진입점: python3 -m ccc_pipeline [--once]"""

from __future__ import annotations

import argparse
import logging
import sys

from .api_client import ApiClient
from .config import ConfigError, load_config
from .worker import run_forever, run_once


def main() -> int:
    parser = argparse.ArgumentParser(prog="ccc_pipeline", description="CCC 처리 장비 폴링 파이프라인")
    parser.add_argument("--once", action="store_true", help="폴링 1회만 실행하고 종료 (스모크 테스트용)")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    try:
        config = load_config()
    except ConfigError as error:
        print(f"config error: {error}", file=sys.stderr)
        return 2

    client = ApiClient(config.api_base_url, config.client_id, config.client_secret)
    if args.once:
        run_once(client, config)
        return 0
    run_forever(client, config)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
