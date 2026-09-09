// D41 정본 질문지(`PRD/intake-questionnaire-v1.md`)를 화면이 읽는 표로 옮긴 것.
// 문구와 선택값은 정본을 그대로 쓰고, 키는 서버의 `INTAKE_ANSWER_KEYS` 어휘다.
// 화면이 질문을 새로 만들거나 선택값을 바꾸지 않는다.

export const INTAKE_RESPONSES = ['answered', 'declined', 'unknown', 'not_applicable'] as const;
export type IntakeResponse = (typeof INTAKE_RESPONSES)[number];
export const INTAKE_RESPONSE_LABELS: Record<IntakeResponse, string> = {
  answered: '답변함', declined: '무응답', unknown: '모름', not_applicable: '해당 없음',
};

export interface IntakeQuestion {
  key: string;
  label: string;
  /** 정본의 선택값. 있으면 고르고, 없으면 직접 적는다. */
  options?: readonly string[];
  hint?: string;
  long?: boolean;
}

export interface IntakeSection {
  id: string;
  title: string;
  questions: readonly IntakeQuestion[];
}

export interface IntakeStep {
  part: 1 | 2 | 3 | 4;
  title: string;
  description: string;
  sections: readonly IntakeSection[];
}

export const INTAKE_STEPS: readonly IntakeStep[] = [
  {
    part: 1,
    title: '상담 신청 및 기본정보',
    description: '기본정보, 수급자 여부, 상담 운영정보와 상담 신청 사유를 기록합니다.',
    sections: [
      {
        id: 'welfare',
        title: '1-2. 공적급여와 수급자 여부',
        questions: [
          { key: 'welfare_basic_livelihood', label: '기초생활보장 수급 여부',
            options: ['수급 중', '과거 수급', '비수급', '신청·심사 중'] },
          { key: 'welfare_benefit_type', label: '수급 유형',
            options: ['생계급여', '의료급여', '주거급여', '교육급여', '복수 급여', '해당 없음'] },
          { key: 'welfare_near_poverty', label: '차상위계층 여부', options: ['해당', '비해당', '신청·확인 중'] },
          { key: 'welfare_other', label: '기타 공적급여', hint: '예: 한부모가족 지원, 장애인연금, 기초연금, 해당 없음' },
        ],
      },
      {
        id: 'operation',
        title: '1-3. 상담 운영정보',
        questions: [
          { key: 'counsel_method', label: '상담 방법',
            options: ['대면', '전화', '온라인 화상', '가정·현장 방문', '기타'] },
          { key: 'referral_path', label: '상담 신청과 유입 경로',
            options: ['본인 신청', '가족·지인 소개', '기관 의뢰', '온라인·홍보물', '기존 이용자 재상담', '기타'] },
          { key: 'contact_time', label: '주요 연락 가능 시간',
            options: ['평일 오전', '평일 오후', '평일 저녁', '주말', '시간 협의 필요'] },
          { key: 'contact_caution', label: '연락 시 주의사항',
            hint: '예: 문자 우선, 평일 18시 이후 가능, 가족에게 상담 사실 비공개, 해당 없음' },
        ],
      },
      {
        id: 'application',
        title: '1-4. 상담 신청 사유',
        questions: [
          { key: 'application_reason', label: '상담을 신청한 주된 사유',
            options: ['경제·생계 어려움', '부채·연체 문제', '일자리·소득 불안정', '주거 문제', '건강·의료 문제',
              '심리·정서 어려움', '가족·관계 문제', '돌봄 부담', '법률·행정 문제', '복합적인 어려움', '기타'] },
          { key: 'application_reason_detail', label: '구체적인 신청 배경', long: true,
            hint: '예: 가족 간병으로 근로시간이 줄어 생활비와 카드대금 연체가 발생함' },
        ],
      },
    ],
  },
  {
    part: 2,
    title: '현재 생활상황',
    description: '경제, 고용, 주거, 건강, 심리와 정서, 가족과 돌봄 상황을 확인합니다.',
    sections: [
      {
        id: 'areas',
        title: '어려움 관련 영역',
        questions: [
          { key: 'difficulty_areas', label: '현재 어려움 관련 영역',
            options: ['경제', '일·고용', '주거', '건강', '심리·정서', '가족·관계', '돌봄', '법률·행정', '기타'] },
        ],
      },
      {
        id: 'economy',
        title: '2-1. 경제와 부채상황',
        questions: [
          { key: 'economy_income_type', label: '주된 소득 유형',
            options: ['근로소득', '사업소득', '공적급여', '연금', '가족·지인 지원', '소득 없음', '복수 소득'] },
          { key: 'economy_monthly_income', label: '월평균 소득', hint: '예: 약 180만원, 변동 있음' },
          { key: 'economy_monthly_expense', label: '월 지출', long: true,
            hint: '예: 월세 50만원, 식비 40만원, 의료비 15만원, 부채상환 30만원' },
          { key: 'economy_arrears', label: '연체와 미납 여부', options: ['없음', '있음', '상환 유예·조정 중'] },
          { key: 'economy_debt_types', label: '대출과 부채 현황',
            options: ['금융기관 대출', '카드대금', '임대료·관리비', '공과금·통신비', '거래처 미지급금',
              '가족·지인 차용', '기타', '해당 없음'] },
        ],
      },
      {
        id: 'employment',
        title: '2-2. 일과 고용상황',
        questions: [
          { key: 'employment_status', label: '현재 경제활동 상태',
            options: ['상용근로', '임시·일용근로', '자영업·프리랜서', '구직 중', '휴직·병가', '비경제활동'] },
          { key: 'employment_income_stability', label: '소득 안정성',
            options: ['안정적', '다소 불안정', '매우 불안정', '소득 없음'] },
          { key: 'employment_detail', label: '상세내용', long: true,
            hint: '예: 주 3일 배달업, 최근 가족돌봄으로 근로시간이 주 20시간에서 10시간으로 감소' },
        ],
      },
      {
        id: 'housing',
        title: '2-3. 주거상황',
        questions: [
          { key: 'housing_type', label: '주거 형태',
            options: ['자가', '전세', '보증부 월세', '월세', '공공임대', '가족·지인 거주지',
              '고시원·숙박시설', '시설·임시거처'] },
          { key: 'housing_instability', label: '주거 불안 수준',
            options: ['문제 없음', '비용 부담', '퇴거·이사 가능성', '주거환경 문제', '긴급 주거위기'] },
          { key: 'housing_detail', label: '상세내용', long: true,
            hint: '예: 자녀 1명과 월세 거주, 월세 2개월 미납으로 임대인 독촉 중' },
        ],
      },
      {
        id: 'health',
        title: '2-4. 건강과 심리정서',
        questions: [
          { key: 'health_physical', label: '신체 건강상태',
            options: ['양호', '만성질환 관리 중', '치료 필요', '일상생활 제한 있음'] },
          { key: 'health_care_barrier', label: '치료 접근 어려움',
            options: ['없음', '비용', '시간', '이동', '돌봄 공백', '기타'] },
          { key: 'health_stress', label: '스트레스 수준', options: ['낮음', '보통', '높음', '매우 높음'] },
          { key: 'health_daily_impact', label: '일상생활 영향',
            options: ['영향 없음', '수면', '식사', '외출', '관계', '근로', '복합 영향'] },
          { key: 'health_detail', label: '상세내용', long: true,
            hint: '예: 허리디스크 치료 중이며 치료비 부담으로 물리치료를 중단함' },
        ],
      },
      {
        id: 'family',
        title: '2-5. 가족, 관계, 돌봄',
        questions: [
          { key: 'family_household_type', label: '가구 형태',
            options: ['1인 가구', '부부 가구', '부모·자녀 가구', '한부모 가구', '조손 가구', '다세대 가구', '기타'] },
          { key: 'family_care_burden', label: '돌봄 부담',
            options: ['없음', '아동 돌봄', '노인 돌봄', '장애·질병 가족 돌봄', '본인이 돌봄 받음', '복수 돌봄'] },
          { key: 'family_detail', label: '상세내용', long: true,
            hint: '예: 치매 진단을 받은 어머니를 주 5일 돌보고 있으며 형제의 지원은 거의 없음' },
        ],
      },
    ],
  },
  {
    part: 3,
    title: '필요한 도움과 활용 가능한 자원',
    description: '원하는 도움, 기존 지원 경험, 강점과 관계망, 현재 연계 자원을 기록합니다.',
    sections: [
      {
        id: 'needs',
        title: '3-1. 우선적으로 필요한 도움',
        questions: [
          { key: 'need_primary', label: '1순위 지원욕구',
            options: ['생계비·긴급지원', '채무상담·채무조정', '일자리·소득지원', '주거지원', '의료지원', '심리상담',
              '가족·돌봄지원', '법률·행정지원', '교육·훈련', '정보제공·기관연계', '기타'] },
          { key: 'need_secondary', label: '2순위 지원욕구',
            options: ['해당 없음', '생계비·긴급지원', '채무상담·채무조정', '일자리·소득지원', '주거지원', '의료지원',
              '심리상담', '가족·돌봄지원', '법률·행정지원', '교육·훈련', '정보제공·기관연계', '기타'] },
          { key: 'need_detail', label: '상세내용', long: true,
            hint: '예: 당장 카드 연체를 막기 위한 채무상담과 단기 생계비 지원을 우선 희망함' },
        ],
      },
      {
        id: 'previous',
        title: '3-2. 이전 지원 경험',
        questions: [
          { key: 'previous_support_detail', label: '상세내용', long: true,
            hint: '예: 2025년 주민센터 긴급복지 상담, 소득기준 초과로 미지원' },
        ],
      },
      {
        id: 'strength',
        title: '3-4. 강점과 비공식 자원',
        questions: [
          { key: 'strength_relational', label: '도움을 요청할 사람', hint: '예: 누나, 직장 동료 1명, 없음' },
          { key: 'strength_personal', label: '본인의 강점', hint: '예: 성실한 근무경력, 온라인 판매 경험' },
          { key: 'strength_detail', label: '상세내용', long: true,
            hint: '예: 어려움이 있어도 근로를 유지해 왔고 필요한 서류를 직접 준비하는 실행력이 있음' },
        ],
      },
    ],
  },
  {
    part: 4,
    title: '상담 정리와 후속관리',
    description: '상담 참여 여건, 추가 확인사항, 담당 실무자 의견을 정리합니다.',
    sections: [
      {
        id: 'participation',
        title: '4-1. 상담 참여 여건',
        questions: [
          { key: 'participation_barrier', label: '참여 방해요인',
            options: ['없음', '근무시간', '돌봄 부담', '이동 어려움', '건강 문제', '연락 어려움',
              '디지털 사용 어려움', '비용 부담', '복수 요인', '기타'] },
          { key: 'participation_preferred_method', label: '선호 상담 방식',
            options: ['대면', '전화', '온라인 화상', '방문', '혼합'] },
          { key: 'participation_detail', label: '상세내용', long: true,
            hint: '예: 평일 낮에는 돌봄 때문에 참여가 어렵고 화요일 18시 이후 전화상담 가능' },
        ],
      },
      {
        id: 'summary',
        title: '4-3. 담당 실무자 판단과 다음 단계',
        questions: [
          { key: 'summary_urgency', label: '긴급도', options: ['일반', '주의', '긴급', '즉시 개입 필요'] },
          { key: 'summary_direction', label: '주요 지원방향',
            options: ['정보 제공', '기관 연계', '사례관리 진행', '단기 집중지원', '전문상담 의뢰', '추가 사정 후 결정'] },
        ],
      },
    ],
  },
];

/** 반복 행 표 3종. 첫 열만 필수이고 나머지는 적은 것만 보낸다. */
export const INTAKE_TABLES = {
  debts: {
    title: '채무 현황',
    hint: '채무가 없으면 첫 행 기관에 해당 없음을 적습니다',
    required: { key: 'creditor', label: '기관 또는 채권자' },
    optional: [
      { key: 'kind', label: '구분' },
      { key: 'balance', label: '잔액' },
      { key: 'monthlyPayment', label: '월 상환액' },
      { key: 'arrearsStatus', label: '연체 여부와 상태' },
    ],
  },
  linkedOrgs: {
    title: '3-3. 현재 연계된 기관과 서비스',
    hint: '연계 자원이 없으면 첫 행 기관명에 해당 없음을 적습니다',
    required: { key: 'orgName', label: '기관명' },
    optional: [
      { key: 'serviceName', label: '사업 또는 서비스명' },
      { key: 'supportDetail', label: '지원내용과 금액' },
      { key: 'usagePeriod', label: '이용기간' },
      { key: 'progressStatus', label: '진행상태와 담당자' },
    ],
  },
  additionalItems: {
    title: '4-2. 추가 확인사항',
    hint: '다음 상담 전에 확인할 것을 적습니다',
    required: { key: 'item', label: '추가 확인사항' },
    optional: [
      { key: 'reason', label: '필요한 이유' },
      { key: 'method', label: '확인 방법' },
      { key: 'dueNote', label: '확인 예정 시점' },
    ],
  },
} as const;

export type IntakeTableName = keyof typeof INTAKE_TABLES;
