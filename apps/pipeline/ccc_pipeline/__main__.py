"""진입점: python3 -m ccc_pipeline [--once]"""

from __future__ import annotations

import argparse
import logging
import sys

from .api_client import ApiClient
from .config import ConfigError, load_config
from .masking import MaskingConfigError
from .worker import assert_device_ready, run_forever, run_once


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

    # 설치 점검은 폴링을 시작하기 전에 한다 — 설정이 틀린 채로 도는 것이 가장 나쁘다.
    try:
        assert_device_ready(config)
    except MaskingConfigError as error:
        print(f"device not ready: {error}", file=sys.stderr)
        return 2

    client = ApiClient(
        config.api_base_url,
        config.client_id,
        config.client_secret,
        runtime_environment=config.runtime_environment,
        preview_access_code=config.preview_access_code,
    )
    if args.once:
        run_once(client, config)
        return 0
    run_forever(client, config)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
