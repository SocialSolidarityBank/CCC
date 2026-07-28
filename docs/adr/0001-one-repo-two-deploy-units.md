# 한 레포, 두 배포 단위 (화면 / API 분리)

코드는 이 저장소 하나에 두되, 배포 단위는 화면(apps/web, Next.js → Cloudflare Pages)과 API(apps/api, Cloudflare Workers + gateway)로 나눈다. D1 스키마·마이그레이션(db/)과 공유 타입은 레포 안에서 공유하고, 2단계의 Mac Mini 파이프라인도 pipeline/ 폴더로 같은 레포에 합류한다.

이렇게 나눈 이유: ① D13에서 Mac Mini는 "Workers API만 호출"하기로 확정했으므로 API가 화면과 독립된 주소·수명을 가져야 하고, ② Cloudflare Access 정책을 직원용(화면)과 기계용(서비스 토큰, API)으로 분리해 걸 수 있으며, ③ 화면 코드 변경이 파이프라인 API 계약을 흔들지 않는다.

## Considered Options

- **Next.js 단일 배포(API 내장)** — 배포 단위 1개로 가장 단순하지만, Mac Mini용 API 계약이 화면 배포에 묶이고 기계용 Access 정책 분리가 까다로워 기각.
- **레포 2개 분리** — 스키마·타입 공유가 번거롭고 1인 개발 규모에 과해서 기각. 팀이 커지면 재검토.

(2026-07-08 그릴링 세션에서 결정)
