# 운영 D1 `ccc` 변경 후 상태 (2026-09-16)

## 실행한 변경 (Q 승인 유일 변경)

```sql
UPDATE users SET auth_subject = '9e8c5542-b271-40bf-aff3-9812e819262a'
WHERE id = '8fd733ce-e1f2-4483-9cc7-37390b86b2f2' AND auth_subject IS NULL
```

- 대상: `role=admin` 행 하나(사전 SELECT 로 정확히 1행 확인)
- `auth_subject` = Supabase Auth `seongqkim@bss.or.kr` 계정의 sub UUID
- 결과: `changes: 1` — 한 행 한 컬럼만 변경. DELETE 없음, 다른 표 없음.

## 전후 비교

| 항목 | 전 | 후 |
|---|---|---|
| `users` 행 수 | 2 | 2 |
| `auth_subject IS NULL` | 2 | 1 |
| `user_role_assignments` 행 수 | 2 | 2 |
| admin 행 `auth_subject` | NULL | `9e8c5542-b271-40bf-aff3-9812e819262a` |

## 되돌림 지점

- Time Travel 북마크: `00001333-00000000-000050e8-31de9b6b3ef49e4d00860973c923d0fe` (before.md)
- 수동 되돌림: `UPDATE users SET auth_subject = NULL WHERE id = '8fd733ce-…-9cc7'` 한 줄로도 복구 가능.

## Supabase 쪽 사실

- `seongqkim@bss.or.kr` 계정 생성 완료(email_confirm=true). 기존 `seongqkim@ggbss.or.kr` 계정과 별개.
- 계정 비밀번호는 랜덤 생성 — Q 가 모른다. 로그인 화면에 재설정 표면이 없어 Q 가 대시보드에서 비밀번호를 정하거나 recovery 메일이 필요하다(Main 에 보고함).
- `mailer_autoconfirm` 설정은 건드리지 않았다.
