# CCC 프로토타입 (내부 테스트용)

최종 완성본의 핵심 흐름(기록 → STT → 마스킹 → AI 정리 → 승인 → 브리핑)을 실제로 돌려보는 프로토타입.
실DB 없이 Google Sheets에 저장하고, 외부 연결은 전부 테스트 계정만 쓴다.

## 실행

```bash
# 터미널 1: API 서버 (127.0.0.1:8792)
./prototype/server/run.sh

# 터미널 2: 웹 (127.0.0.1:5199)
./prototype/web/run.sh
```

브라우저에서 `http://127.0.0.1:5199` 접속.

## 계정

| 역할 | ID | 비밀번호 |
|---|---|---|
| 관리자 | `admin` | `admin-test-2026` |
| 실무자 | `staff` | `staff-test-2026` |

`run.sh`의 `PROTOTYPE_*_PW` env로 바꿀 수 있다.

## 저장소

Google Sheet `1DiEr-VX9QgJok7294CWKX8WQ2IVnxIRbOqpRb4IUhbE` (탭: participants, sessions).
원음·원문은 저장하지 않고 마스킹된 텍스트와 AI 결과만 간다.

## 외부 연결

- Azure STT: `ccc-stt-koreacentral` 리소스, `az` CLI로 키 주입
- OpenAI: Infisical `prod`/`/`의 `OPENAI_API_KEY` (현재 401 — 갱신 필요)
- Google Sheets: DWD 서비스 계정 (`oauth2service.json`, `seongqkim@ggbss.or.kr` 대리)

## 알려진 제한

- OpenAI 키가 401이라 AI 정리는 아직 실패한다. 마스킹된 텍스트는 저장되므로 키 갱신 후 재처리하면 된다.
- NER은 `PROTOTYPE_NER=1`로 켤 수 있으나 `transformers`+`torch` 설치가 필요하다.
- 세션은 인메모리라 서버 재시작 시 로그아웃된다.
