// D49·D23: 등록 폼 동의 아코디언("자세히 읽어보기") 본문. docs/consent/consent-draft-v0.md의
// 1~6절을 그대로 반영한다 — 정보 표시 전용 상수라 이 파일을 바꿔도 체크박스 이름
// (consentPrivacy/consentRecordingAi)·액션·저장 구조에는 아무 영향이 없다. 문안 갱신 시 두 파일을
// 함께 고친다. D49(2026-07-30): 구 [선택] 2항목(녹음·음성 분석 / 텍스트 AI 정리)을 한 항목
// ('AI를 활용한 녹취기록')으로 합쳤다 — 정본 5·6절과 같은 문안이다.

import { CONSENT_TEXT_AI_NOTICE_TEXT } from '../../../../../db/consent-notice';

export const CONSENT_DETAIL_DISCLAIMER =
  '법률 검토 전 참고용 초안입니다(D23·D26). 동의는 서면·구두(오프라인)로 받으며, 시스템에는 항목별 동의 여부·일시·기록자만 기록됩니다. 전자서명·당사자 직접 작성은 법률 검토 후 제공됩니다.';

export interface ConsentDetailSection {
  heading: string;
  paragraphs?: string[];
  items?: string[];
}

export const CONSENT_DETAIL_SECTIONS: ConsentDetailSection[] = [
  {
    heading: '1. 수집·이용 목적',
    paragraphs: ['상담(사례관리) 제공과 상담 기록 관리, 지원 사업 운영 및 가명 처리 후 통계 작성.'],
  },
  {
    heading: '2. 수집 항목',
    paragraphs: ['성명, 연락처, 이메일, 상담 과정에서 작성되는 상담 기록.'],
  },
  {
    heading: '3. 보유·이용 기간',
    paragraphs: [
      '상담 종결 후 내부 보유 기간(현행 1년)이 지나면 성명·연락처 등 개인 식별 정보는 파기합니다.',
      '파기 후에도 개인을 알아볼 수 없도록 가명 처리된 상담 기록은 통계·서비스 개선 목적으로 보존됩니다.',
    ],
  },
  {
    heading: '4. 열람 범위',
    paragraphs: [
      '성명 등 개인정보는 담당 실무자 및 기관 관리자만 열람하며, 모든 열람은 기록(감사)됩니다.',
      '같은 기관의 다른 실무자에게는 참여 중인 사업 목록과 담당 실무자 이름이 표시됩니다. 상담 내용(상담 기록·브리핑)과 개인정보는 담당 실무자 및 기관 관리자만 볼 수 있습니다.',
    ],
  },
  {
    heading: '5. 선택 동의 (거부해도 등록·상담 이용에 불이익이 없습니다)',
    // ② 항목 본문은 게이트웨이와 같은 상수를 쓴다 — 체크할 때 근거 표에 남기는
    // 해시가 화면에 보인 문안과 같아야 하기 때문이다(ADR-0027).
    items: [CONSENT_TEXT_AI_NOTICE_TEXT],
  },
  {
    heading: '6. 동의 거부 권리',
    paragraphs: [
      '각 항목의 동의를 거부할 수 있으며, 거부하더라도 상담 서비스 이용에 불이익이 없습니다. 다만 AI를 활용한 녹취기록에 동의하지 않으면 녹음·전사·감정 추이 분석과 AI 요약·정리가 모두 제공되지 않습니다. 실무자가 직접 작성하는 상담 기록은 그대로 유지됩니다.',
    ],
  },
];

// 항목별 전문(2026-08-07 Q — 동의 수정 허브의 체크박스별 '전문 보기'). **문안을 새로 쓰지
// 않는다** — 위 정본 절을 항목별로 갈라 실을 뿐이다. 개인정보 = 1~4·6절, AI 녹취 = 5·6절.
export const CONSENT_PRIVACY_SECTIONS: ConsentDetailSection[] =
  CONSENT_DETAIL_SECTIONS.filter((section) => !section.heading.startsWith('5.'));

export const CONSENT_RECORDING_AI_SECTIONS: ConsentDetailSection[] =
  CONSENT_DETAIL_SECTIONS.filter((section) => section.heading.startsWith('5.') || section.heading.startsWith('6.'));
