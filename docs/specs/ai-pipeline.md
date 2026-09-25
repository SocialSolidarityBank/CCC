# AI 파이프라인 스펙 (구 CLAUDE.md §5)

> 2026-09-26 분리: 원문은 `CLAUDE.md` §5 에 있던 내용을 그대로 옮겼다. 판정 우선순위와 인용 규칙은 `CLAUDE.md` 가 정한다.

파이프라인은 **두 갈래**다. 녹음이 있는 회차는 Agent가 원음에서 전사·화자 분리·마스킹을 수행하고, 수기 메모만 있는 회차는 전사·감정을 건너뛰고 텍스트 일감 큐에서 2차 마스킹부터 시작한다(D57). 세 모드의 저장소 차이는 `AudioStore`가 감싼다. Community Cloud 원음은 기관 소유 Supabase private Storage에만 두고, Local은 암호화 파일에 둔다(D76·D81).

```
원음 업로드 → AudioStore 임시 저장
  → 다음 영업일의 첫 Agent 처리 기회에 Agent claim
  → 전사(무음 경계 청크 분할 + 반복 검사 필수, D53) + pyannote 화자 분리
  → 화자 매핑 자동 추정 → 검토 화면에서 실무자가 1회 확인
  → 감정 분석(보류 규칙 유지, D64)
  → PII 2단 마스킹(등록값 치환 + 로컬 NER + 준식별자 일반화)
  → AI Packet과 근거 hash를 코어가 재검증
  → 마스킹 스냅샷만 저장 → OpenAI API 호출(`store:false`, D57·D81)
  → Agent 처리 뒤 원음 즉시 삭제, 삭제 증거 기록
  → 첫 처리 가능 시점부터 24시간 안에도 처리하지 못하면 원음 삭제 + 관리자 장애 상태 기록
```

`sttMode`의 설치 기본값은 세 모드 모두 `off`다. 관리자가 provider를 명시적으로 고르고 health check를 통과해야 `local` 또는 `azure`가 된다. STT-G1~STT-G3 결과를 Q가 승인하기 전에는 `sttEngine`이 `null`이고 faster-whisper를 자동 선택하지 않는다(D77).

OpenAI에는 장비가 만든 AI Packet만 보낸다. 스냅샷이 없거나 아래 fail-closed 상태가 발생하면 외부 AI 호출을 하지 않고 수기 경로를 제공한다. 로그에는 code, session ID hash, timestamp만 남긴다.

| code | 화면 문구 |
|---|---|
| `masking_snapshot_missing` | 가림 처리 결과가 없어 AI 처리를 멈췄습니다. |
| `local_ner_unavailable` | 이름과 주소 가림 기능을 사용할 수 없어 AI 처리를 멈췄습니다. |
| `registered_pii_detected` | 등록된 개인정보가 남아 있어 AI 처리를 멈췄습니다. |
| `unmasked_identifier_detected` | 가려지지 않은 식별 정보가 감지되어 AI 처리를 멈췄습니다. |
| `evidence_hash_mismatch` | 근거 확인값이 맞지 않아 AI 처리를 멈췄습니다. |
| `masking_pipeline_version_mismatch` | 가림 처리 버전이 맞지 않아 AI 처리를 멈췄습니다. |
| `consent_not_effective` | 현재 동의 상태로는 외부 AI 처리를 진행할 수 없습니다. |

재료별 24,000자 상한을 넘는 전사문은 S15 규칙대로 시간 구간별로 나눠 보내고, 누락 구간을 실무자에게 표시한다. AI 초안은 `approved_at` 전에는 공식 기록이 아니며, 수기 메모는 작성 즉시 공식 기록이다(R2·D5). 목표 모델 검수 4건은 E2-8이 소유한다.

처리 SLA는 업로드 후 다음 영업일의 첫 Agent 처리 기회까지다. Agent가 6시간 이상 폴링하지 않으면 관리자 알림을 보낸다(녹음·텍스트 두 일감 큐 합산). 처리 실패 뒤 다른 사업자로 자동 전환하지 않는다(D8).

모델 정보:
- LLM: **OpenAI**(`packages/ai-runtime/src/ai-provider.ts`, 프로바이더 슬러그 `codex`). 모델·프롬프트·스키마 버전은 활성 프로바이더 설정 hash로 고정하며, 어긋나면 재활성화 전까지 fail-closed다(D57·ADR-0027).
- STT: 엔진은 STT-G1~STT-G3과 Q 승인 전까지 미확정이다. 후보는 E5-8에서 측정하고, 측정 결과가 승인되기 전까지 Local 선택지는 비활성이다. 무음 경계 청크 분할과 반복 검사는 엔진과 무관하게 필수다(D53·D77).
- 인명·주소 마스킹: `FrameByFrame/korean-pii-e5-base`를 사용하며 미설정이면 Agent가 뜨지 않는다(R3).
- 화자 분리: pyannote.audio. 라이선스 미표기 저장소는 사용하지 않는다.
