/**
 * 개인정보 ①과 AI 녹취기록 ② 동의 문안의 단일 정본(CCC-125).
 *
 * 화면은 이 파일의 구조를 직접 렌더하고, 게이트웨이는 같은 문자열에서 해시를 계산한다.
 * 문안을 고치면 버전을 함께 올린다. 기존 기록은 해시와 버전으로 구분한다.
 */
// 두 동의 문안은 이번 버전에서 함께 바뀌었지만 다음 변경은 독립일 수 있다.
// 각각의 버전을 따로 둬 버전만으로도 어느 항목의 문안인지 오해하지 않게 한다.
export const CONSENT_PRIVACY_NOTICE_VERSION = 'consent-draft-v0.5';
export const CONSENT_TEXT_AI_NOTICE_VERSION = 'consent-draft-v0.5';

export interface ConsentDetailSection {
  heading: string;
  paragraphs?: string[];
  items?: string[];
}

export const CONSENT_DETAIL_DISCLAIMER =
  '법률 검토 전 참고용 초안입니다(D23·D26). 동의는 서면·구두(오프라인)로 받으며, 시스템에는 항목별 동의 여부·일시·기록자만 기록됩니다. 전자서명·당사자 직접 작성은 법률 검토 후 제공됩니다.';

export const CONSENT_PRIVACY_ACK_TEXT =
  '[필수] 개인정보 수집·이용 동의: 위 1~4절의 내용(목적, 항목, 보유 기간, 열람 범위)에 따라 개인정보를 수집·이용하는 것에 동의합니다.';

export const CONSENT_TEXT_AI_NOTICE_TEXT =
  '[선택] AI를 활용한 녹취기록 동의: 상담 내용을 녹음해 음성-텍스트 전환(전사)과 감정 추이 분석(현재 제공하지 않음, D64 보류)에 이용하고, '
  + '상담 기록(수기 메모·전사)을 AI가 요약·정리합니다. 음성 원본은 업로드 후 30일 이내 자동 삭제됩니다. '
  + '상담 내용에는 건강 상태 등 민감한 정보가 포함될 수 있으며, 이 항목에 동의하면 그러한 내용이 포함된 상담 기록도 아래 보호 조치를 거쳐 처리됩니다. '
  + 'AI 처리 전에 성명·연락처와 구체적인 질병명 등을 가명·마스킹 처리한 뒤 외부 AI 서비스에 위탁 처리하며, '
  + '자동화 기술의 특성상 드물게 일부 정보가 완전히 제거되지 않을 수 있는 잔여 위험이 있습니다. '
  + '이를 최소화하기 위한 2단계 보호 조치를 적용합니다.';

const CONSENT_AI_REJECTION_PARAGRAPH =
  'AI를 활용한 녹취기록(5절의 [선택] 항목)은 거부하더라도 상담 서비스 이용에 어떤 불이익도 없습니다. 다만 이 항목에 동의하지 않으면 녹음·전사·감정 추이 분석(현재 제공하지 않음, D64 보류)과 AI 요약·정리가 모두 제공되지 않습니다. 실무자가 직접 작성하는 상담 기록은 그대로 유지됩니다.';
const CONSENT_PRIVACY_REJECTION_PARAGRAPH =
  '개인정보 수집·이용(1~4절)에 동의하지 않는 경우, 상담 기록 관리가 필요한 서비스의 특성상 등록과 상담 제공이 어렵습니다. 급박한 위기 상황에서는 동의에 앞서 필요한 지원을 먼저 제공하고, 이후 동의 절차를 안내할 수 있습니다.';
const CONSENT_MINOR_PARAGRAPH =
  '만 14세 미만 당사자의 경우 법정대리인의 동의가 필요합니다.';
const CONSENT_REJECTION_PARAGRAPHS = [
  CONSENT_AI_REJECTION_PARAGRAPH,
  CONSENT_PRIVACY_REJECTION_PARAGRAPH,
  CONSENT_MINOR_PARAGRAPH,
];

export const CONSENT_DETAIL_SECTIONS: ConsentDetailSection[] = [
  {
    heading: '1. 수집·이용 목적',
    paragraphs: ['상담(사례관리) 제공과 상담 기록 관리, 지원 사업 운영 및 가명 처리 후 통계 작성.'],
  },
  {
    heading: '2. 수집 항목',
    items: [
      '필수: 성명, 연락처, 생년월일(또는 연령대), 거주 지역(시·군·구), 상담 과정에서 작성되는 상담 기록.',
      '해당 시(목적을 안내하고 수집): 계좌번호(금전 지원 지급 시), 이메일(비대면 안내·문서 송부 시), 긴급 연락처와 관계(위기 대응 시), 상세 주소(가정방문 시).',
    ],
  },
  {
    heading: '3. 보유·이용 기간',
    paragraphs: [
      '상담 종결 후 보관 기간(기본 1년, 기관 규정에 따름)이 지나면 성명·연락처 등 개인 식별 정보는 접근이 제한된 보관(아카이브) 상태로 전환됩니다. 아카이브 상태의 정보는 상담 종결 후 5년이 지나면 파기합니다. 다만 다른 법령이 더 긴 보존을 요구하는 경우 그 기간을 따르며, 동의 철회 등 파기 사유가 먼저 생기면 그때 파기합니다. 파기 후에도 개인을 알아볼 수 없도록 가명 처리된 상담 기록은 통계 작성 목적으로 보존됩니다.',
    ],
  },
  {
    heading: '4. 열람 범위',
    paragraphs: [
      '성명 등 개인정보는 담당 실무자 및 기관 관리자만 열람하며, 모든 열람·다운로드는 기록(감사)됩니다. 개인정보의 시스템 밖 반출은 원칙적으로 제한됩니다.',
      '같은 기관의 다른 실무자에게는 참여 중인 사업 목록과 담당 실무자 이름이 표시됩니다. 상담 내용(상담 기록·브리핑)과 개인정보는 담당 실무자 및 기관 관리자만 볼 수 있습니다.',
    ],
  },
  {
    heading: '5. 동의 항목',
    items: [
      CONSENT_PRIVACY_ACK_TEXT,
      '아래 [선택] 항목은 거부해도 등록·상담 이용에 불이익이 없습니다.',
      CONSENT_TEXT_AI_NOTICE_TEXT,
    ],
  },
  {
    heading: '6. 동의 거부 권리와 동의하지 않을 때의 안내',
    paragraphs: CONSENT_REJECTION_PARAGRAPHS,
  },
];

const PRIVACY_SECTION_FIVE: ConsentDetailSection = {
  heading: CONSENT_DETAIL_SECTIONS[4]?.heading ?? '5. 동의 항목',
  items: [CONSENT_PRIVACY_ACK_TEXT],
};

const RECORDING_AI_SECTION_FIVE: ConsentDetailSection = {
  heading: CONSENT_DETAIL_SECTIONS[4]?.heading ?? '5. 동의 항목',
  items: [
    '아래 [선택] 항목은 거부해도 등록·상담 이용에 불이익이 없습니다.',
    CONSENT_TEXT_AI_NOTICE_TEXT,
  ],
};

const PRIVACY_SECTION_SIX: ConsentDetailSection = {
  heading: CONSENT_DETAIL_SECTIONS[5]?.heading ?? '6. 동의 거부 권리와 동의하지 않을 때의 안내',
  paragraphs: [CONSENT_PRIVACY_REJECTION_PARAGRAPH, CONSENT_MINOR_PARAGRAPH],
};

const RECORDING_AI_SECTION_SIX: ConsentDetailSection = {
  heading: CONSENT_DETAIL_SECTIONS[5]?.heading ?? '6. 동의 거부 권리와 동의하지 않을 때의 안내',
  paragraphs: [CONSENT_AI_REJECTION_PARAGRAPH],
};

export const CONSENT_PRIVACY_SECTIONS: ConsentDetailSection[] = [
  ...CONSENT_DETAIL_SECTIONS.slice(0, 4),
  PRIVACY_SECTION_FIVE,
  PRIVACY_SECTION_SIX,
];

export const CONSENT_RECORDING_AI_SECTIONS: ConsentDetailSection[] = [
  RECORDING_AI_SECTION_FIVE,
  RECORDING_AI_SECTION_SIX,
];

function renderNoticeText(sections: ConsentDetailSection[]): string {
  return sections.flatMap((section) => [
    section.heading,
    ...(section.paragraphs ?? []),
    ...(section.items ?? []),
  ]).join('\n');
}

export const CONSENT_PRIVACY_NOTICE_TEXT = renderNoticeText(CONSENT_PRIVACY_SECTIONS);
