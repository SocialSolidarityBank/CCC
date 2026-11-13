# 운영 D1 `ccc` 변경 전 상태 (2026-09-16)

## Time Travel 북마크 (변경 직전, 이번에 새로 찍은 것)

- bookmark: `00001333-00000000-000050e8-31de9b6b3ef49e4d00860973c923d0fe`
- 발급 시각: 2026-09-16 10:55 KST
- 발급 명령: `wrangler d1 time-travel info ccc --env production --json` (Infisical `/CLOUDFLARE` 주입)
- 어제 북마크(`000012b2-…`)와 별개다. 되돌림 기준은 이 값이다.

## 읽기 전용 조회 결과

- `users` 행 수: 2
  - `auth_subject IS NULL`: 2 (전부)
  - 행 구성: `role=admin` 1행(id `8fd733ce-…-9cc7`), `role=service` 1행(id `b025ca3c-…-d25213`), 둘 다 `active=1`
- `user_role_assignments` 행 수: 2
  - `institution_admin` 1행(active), `institution_technical_admin` 1행(active)
  - 둘 다 admin 사용자 행 소유, `source=legacy`
  - service 행은 역할 0건(서비스 계정이라 정상)

## 스키마 확인 (0045 재건 기준)

- `users.auth_subject`: `TEXT CHECK (NULL OR length(trim)>0)`, 부분 유일 인덱스 `uq_users_auth_subject WHERE auth_subject IS NOT NULL`
- `auth_subject` 업데이트를 막는 트리거 없음 — users 트리거는 `UPDATE OF active`(마지막 필수 역할 가드), `AFTER INSERT`(역할 시드), `AFTER UPDATE OF role`(역할 동기) 뿐이다.
- 예정 변경: admin 행 하나의 `auth_subject` 만 채운다. 다른 컬럼·행·표 변경 없음.
