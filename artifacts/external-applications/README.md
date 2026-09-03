# CCC-191 외부 신청과 자격 확인 기록

확인 시각은 2026-09-03 22:29 KST입니다. 이 문서는 신청 상태와 다음 행동만 기록합니다. 계정 식별자, 인증 정보, 결제 정보, 신분증, 계약서 원문은 저장하지 않았습니다.

## 상태 요약

| 항목 | 현재 상태 | 담당자 | 회신 또는 다음 확인 | 증거 |
|---|---|---|---|---|
| OV/EV 코드서명 인증서 | 보류. 현재 개발과 오픈소스 공개 단계에서는 구매하거나 신청하지 않습니다. | Seongqkim | 유료 서비스 시작 또는 정식 Windows 설치판 배포를 결정할 때 다시 검토합니다. | [DigiCert 신청 요건](https://docs.digicert.com/en/certcentral/order-and-manage-certificates/request-certificates/request-a-code-signing-or-ev-code-signing-certificate/request-code-signing-certificate.html) |
| Microsoft Artifact Signing Public Trust | 보류. 현재 스폰서십 구독은 지원 대상이 아니며 별도 PAYG 구독도 만들지 않습니다. | Seongqkim | 유료 서비스 시작 또는 정식 Windows 설치판 배포를 결정할 때 다시 검토합니다. | [Artifact Signing FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq#can-i-use-artifact-signing-with-a-free-trial-or-sponsored-azure-subscription) |
| Microsoft 비영리 자격과 Azure grant | 비영리 자격과 USD 2,000 grant가 활성 상태입니다. 구독은 MCA 기반 Microsoft Azure Plan이며 Azure 비영리 스폰서십 크레딧이 연결돼 있습니다. | Seongqkim | grant 범위 안에서 개발용 Azure 리소스가 필요할 때 사용합니다. | `microsoft-nonprofit-approval-redacted.png`, `azure-grant-approved-redacted.png`, [Azure Plan](https://azure.microsoft.com/ko-kr/pricing/offers/ms-azr-0017g/) |
| pyannote gated model 2종 | 두 저장소 모두 접근이 승인됐습니다. | Seongqkim | 승인 완료. E5-2에서 고정 revision 다운로드를 검증합니다. | `pyannote-speaker-diarization-3.1-access.png`, `pyannote-segmentation-3.0-access.png` |
| OpenAI DPA | 2026-09-03 08:16 KST에 문서가 전달됐지만 09:03 KST에 서명이 거부되어 요청이 종료됐습니다. 유효한 DPA는 없습니다. | Seongqkim | 2026-09-04 09:00 KST에 기관 API 조직과 권한 있는 서명자의 지정 상태를 확인합니다. | `openai-dpa-request-confirmation.png`, `openai-dpa-delivery-redacted.png`, `openai-dpa-decline-mail-redacted.png` |
| 법무 조정 | CCC-191, SG14, E11-1a의 Linear 담당자는 Seongqkim입니다. 외부 법률 검토자와 권한 있는 서명자는 아직 정해지지 않았습니다. | Seongqkim | E11-1a 담당자표 2026-09-04, SG14 계약 2026-09-05 | Linear `CCC-191`, `CCC-189`, `CCC-157` |

## Microsoft와 코드서명

Microsoft Elevate의 비영리 보조금 및 할인 대상 승인이 완료됐습니다. Azure grant는 2026-09-03부터 2027-09-03까지 USD 2,000이며, 현재 MCA 기반 Microsoft Azure Plan 구독에 `Azure non-profit sponsorship credit`으로 연결돼 있습니다.

Artifact Signing 생성 화면에서는 현재 구독을 선택할 수 있지만, Microsoft는 스폰서 Azure 구독을 지원 대상에서 제외합니다. 사용 가능한 구독처럼 보이는 것만으로 실제 발급 자격을 충족했다고 판정하지 않습니다.

2026-09-03 Q 결정에 따라 OV/EV 인증서 구매와 별도 PAYG 구독 생성은 모두 보류합니다. 현재는 서비스 전 개발과 오픈소스 공개 단계이고 코드서명 예산이 없습니다. 설치 파일은 서명 요건을 충족하기 전까지 개발판으로만 표시합니다.

코드서명은 다음 조건 중 하나가 생길 때 다시 검토합니다.

1. 유료 서비스를 시작합니다.
2. 일반 사용자에게 정식 Windows 설치판을 배포합니다.

재검토 시점에 예산, 배포 방식, 자동화 필요를 다시 확인하고 OV/EV와 Artifact Signing 중 적합한 방법을 선택합니다.

공식 근거:

- [Artifact Signing quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
- [Artifact Signing trust models](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-trust-models)
- [Artifact Signing FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)
- [DigiCert Code Signing 또는 EV Code Signing 신청 요건](https://docs.digicert.com/en/certcentral/order-and-manage-certificates/request-certificates/request-a-code-signing-or-ev-code-signing-certificate/request-code-signing-certificate.html)

## 모델 접근과 라이선스

두 pyannote 저장소는 2026-09-03 07:53 KST에 로그인된 담당자 계정에서 `You have been granted access to this model` 상태를 확인했습니다. 토큰과 쿠키는 기록하지 않았습니다.

| 모델 | 고정 revision | 라이선스 | 접근 상태 | 원문 |
|---|---|---|---|---|
| `pyannote/speaker-diarization-3.1` | `84fd25912480287da0247647c3d2b4853cb3ee5d` | MIT | gated, 승인됨 | [Hugging Face API](https://huggingface.co/api/models/pyannote/speaker-diarization-3.1?expand%5B%5D=sha&expand%5B%5D=cardData) |
| `pyannote/segmentation-3.0` | `e66f3d3b9eb0873085418a7b813d3b369bf160bb` | MIT | gated, 승인됨 | [Hugging Face API](https://huggingface.co/api/models/pyannote/segmentation-3.0?expand%5B%5D=sha&expand%5B%5D=cardData) |
| `jungjongho/wav2vec2-xlsr-korean-speech-emotion-recognition` | `c9d0e4a8eaa1613129c50d7a42ab569c94c46b85` | Apache-2.0 | 공개 | [Hugging Face API](https://huggingface.co/api/models/jungjongho/wav2vec2-xlsr-korean-speech-emotion-recognition?expand%5B%5D=sha&expand%5B%5D=cardData) |
| `LimYeri/HowRU-KoELECTRA-Emotion-Classifier` | `072596063415c754b5661ab2bdda7afa10eca726` | MIT | 공개 | [Hugging Face API](https://huggingface.co/api/models/LimYeri/HowRU-KoELECTRA-Emotion-Classifier?expand%5B%5D=sha&expand%5B%5D=cardData) |
| `FrameByFrame/korean-pii-e5-base` | `a308c54b4407819624a5661e31e162a269f39818` | MIT | 공개 | [Hugging Face API](https://huggingface.co/api/models/FrameByFrame/korean-pii-e5-base?expand%5B%5D=sha&expand%5B%5D=cardData) |

표에 있는 5개 모델의 정본은 `supply-chain/model-license-manifest.json`입니다. 이 표는 2026-09-03의 접근 상태와 원문 대조 결과를 함께 남긴 증거입니다. 실제 authenticated download와 checksum 검증은 E5-2가 담당합니다.

## OpenAI DPA

OpenAI가 검토 문서를 2026-09-03 08:16:44 KST에 지정된 메일함으로 전달했습니다. 양식 제출 완료 화면은 그 직후인 08:17:48 KST에 저장했습니다. 해당 문서는 09:03:47 KST에 서명이 거부돼 발송인에게 통지됐고, 요청은 종료됐습니다.

현재 OpenAI API 화면에서는 개인 조직과 기본 프로젝트만 확인됐으며 기관 API 조직은 확인되지 않았습니다. ChatGPT Business workspace가 있다는 사실만으로 API 조직의 법적 계약 권한을 추정하지 않습니다. 새 DPA는 다음 두 조건을 먼저 충족한 뒤 요청합니다.

1. 기관 명의 OpenAI API 조직과 계약 대상 범위를 확인합니다.
2. 기관을 대표해 계약할 권한이 있는 서명자를 지정합니다.

DPA 요청은 ZDR 또는 MAM 승인과 별개입니다. OpenAI는 [API data controls 문서](https://developers.openai.com/api/docs/guides/your-data)에서 ZDR과 MAM을 사전 승인이 필요한 별도 통제로 설명합니다. 이번 기록은 ZDR이나 MAM이 승인됐다는 근거로 사용하지 않습니다.

다음 확인 시각은 2026-09-04 09:00 KST입니다. 그때 기관 API 조직과 권한 있는 서명자가 모두 정해진 경우에만 새 요청을 만듭니다.

## 법무 후속 경계

E0-4의 조정 담당자는 Linear의 현재 배정에 따라 Seongqkim으로 확정합니다. 이 역할은 외부 법률 검토자나 기관의 계약 서명 권한을 뜻하지 않습니다.

E11-1a가 담당자와 마감을 붙일 법무 항목은 다음 9개입니다.

1. 개인정보 처리방침
2. 동의 여섯 영역 문안
3. Supabase 위탁 문서
4. OpenAI 국외 이전 고지
5. OpenAI DPA의 민감정보 확인 또는 비식별 수준 법률 검토
6. 기관별 보존 근거표
7. 권리요청 10일 절차
8. 침해사고 72시간 절차
9. 2026-09-11 시행 법 개정 대조

- E11-1a, `CCC-189`: 2026-09-04까지 ADR-0041의 법무 항목별 담당자, 마감, 증빙 위치를 기록합니다.
- SG14, `CCC-157`: 2026-09-05까지 LG1~LG3의 계약과 실데이터 차단 조건을 확정합니다.
- 실제 외부 법률 검토자와 권한 있는 서명자는 E11-1a에서 별도로 지정합니다.
- 두 후속 티켓이 닫히기 전에는 이 문서를 실데이터 사용 승인으로 해석하지 않습니다.
