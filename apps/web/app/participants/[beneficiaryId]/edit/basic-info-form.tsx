'use client';

import { useState, type FormEvent } from 'react';
import { WireCard } from '../../../components/wire/wire-card';
import { WireButton } from '../../../components/wire/wire-button';
import { WireFormField } from '../../../components/wire/wire-form-field';
import { ParticipantName } from '../../../components/wire/participant-name';
import { DATE_TEXT_HINT, DateTextInput } from '../../../components/wire/date-text-input';
import type { ParticipantBasicInfo } from '../../../lib/api';

// 성별 선택값은 정본 질문지 1-1 그대로다(D41) — 등록 폼(register-form.tsx)과 같은 목록을
// 쓴다. 빈 값은 '미입력'이며 저장하면 금고에서 지워진다.
const GENDER_OPTIONS = [
  { value: '', label: '선택 안 함' },
  { value: '여성', label: '여성' },
  { value: '남성', label: '남성' },
  { value: '기타', label: '기타' },
  { value: '무응답', label: '무응답' },
];

/** 빈칸 경고 검사 대상 7종 — 폼 name 과 금고 현재값 키. */
const FIELD_NAMES = ['name', 'phone', 'email', 'birthDate', 'region', 'gender', 'account'] as const;
type FieldName = (typeof FIELD_NAMES)[number];

/** 값이 있던 칸을 비운 채 저장할 때 칸 아래 뜨는 경고(2026-08-07 Q — 구 상단 고정
 *  안내 문장 대체). 첫 저장 시도는 막고, 같은 상태로 한 번 더 누르면 삭제로 진행한다. */
const EMPTIED_WARNING = '빈칸으로 저장하면 항목이 삭제됩니다. 삭제하려면 저장을 한 번 더 누르세요.';

export interface BasicInfoFormProps {
  basicInfo: ParticipantBasicInfo;
  /** 제출 시 실행할 서버 액션. 페이지가 주입한다 — 폼을 서버 전용 import 에서 떼어내
   *  단위 테스트에서 렌더 가능하게 한다(register-form.tsx 와 같은 방식). */
  action: (formData: FormData) => void | Promise<void>;
}

/**
 * 당사자 기본정보 수정 폼 (CCC-37 · D41 1-1 · D42 ①).
 *
 * 등록 화면이 받는 7종을 **등록 뒤에 고치는 유일한 자리**다. 인테이크 1단계(1-1)는 이 값을
 * 읽어 표시만 하므로, 거기서 '당사자 등록 정보에서 수정'을 누르면 이 화면으로 온다.
 *
 * 값은 서버가 금고에서 복호화해 내려준 현재 상태이며(D3), 브라우저 임시본(localStorage 등)에
 * 담지 않는다 — 인테이크 임시본이 금고 값을 빼고 저장하는 것과 같은 규율이다(R3).
 *
 * '저장' 버튼은 카드 머리(이름 줄) 우측이다(2026-08-07 Q 4차 — 카드 한 장으로 합치면서
 * 폼 안으로 돌아왔다. form id 는 테스트 앵커로 유지). 값이 있던 칸을 비운 채 저장하면
 * 그 칸 아래 경고가 뜨고 한 번 더 눌러야 지워진다(조용한 금고 삭제 방지).
 */
export function BasicInfoForm({ basicInfo, action }: BasicInfoFormProps) {
  const [warnedFields, setWarnedFields] = useState<FieldName[]>([]);

  const initialValues: Record<FieldName, string> = {
    name: basicInfo.name ?? '',
    phone: basicInfo.phone ?? '',
    email: basicInfo.email ?? '',
    birthDate: basicInfo.birthDate ?? '',
    region: basicInfo.region ?? '',
    gender: basicInfo.gender ?? '',
    account: basicInfo.account ?? '',
  };

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const emptied = FIELD_NAMES.filter(
      (field) => initialValues[field].length > 0 && String(data.get(field) ?? '').trim().length === 0,
    );
    if (emptied.length === 0) {
      setWarnedFields([]);
      return; // 그대로 제출된다.
    }
    // 같은 칸 구성으로 이미 경고를 봤으면 두 번째 제출은 통과한다(삭제 의사 확인 완료).
    const alreadyWarned = emptied.length === warnedFields.length
      && emptied.every((field) => warnedFields.includes(field));
    if (!alreadyWarned) {
      event.preventDefault();
      setWarnedFields(emptied);
    }
  }

  const warningFor = (field: FieldName) =>
    warnedFields.includes(field) ? { error: EMPTIED_WARNING } : {};

  return (
    <form id="basic-info-form" action={action} onSubmit={handleSubmit}>
      {/* 낙관적 잠금 + 쓰기 컨텍스트. 둘 다 서버가 정해 준 값을 그대로 돌려보낸다 —
          화면이 참여 사업을 고르지 않는다. */}
      <input type="hidden" name="beneficiaryId" value={basicInfo.beneficiaryId} />
      <input type="hidden" name="supportCaseContextId" value={basicInfo.supportCaseContextId} />
      <input type="hidden" name="expectedVersion" value={String(basicInfo.version)} />
      {/* 화면 전체가 **카드 한 장**이다(2026-08-07 Q 4차 — 이름 줄까지 합쳤다. 별도 HERO
          카드를 두지 않는 D38 의 화면 단위 예외, DESIGN.md §5 기록).
          골격: 이름·저장 줄 → 풀블리드 가로선 → 기본 정보 구획 → 풀블리드 가로선 →
          추가 정보 구획. **구획 제목 아래에는 선을 긋지 않는다**(Q 지시 — 선은 구획 사이만).
          구획 제목과 필드 사이 간격은 카드 본문 gap 하나(20)로 두 구획이 같다(여백 규칙). */}
      <WireCard className="wire-form-card">
        <div className="participant-hero-top">
          <h1 className="participant-hero-title">
            <ParticipantName name={basicInfo.name} beneficiaryId={basicInfo.beneficiaryId} size="hero" />
          </h1>
          <div className="page-actions">
            <WireButton type="submit" variant="primary">저장</WireButton>
          </div>
        </div>
        <hr className="wire-card-divider" />
        <div className="wire-card-title"><h2>기본 정보</h2></div>
        <div className="wire-form-grid">
          <WireFormField label="이름" htmlFor="basicInfoName" {...warningFor('name')}>
            <input id="basicInfoName" name="name" type="text" maxLength={100} defaultValue={basicInfo.name ?? ''} />
          </WireFormField>
          {/* 라벨은 '연락처'다(2026-08-07 Q — 구 '휴대전화'. 등록 화면·당사자 카드와 같은 말). */}
          <WireFormField label="연락처" htmlFor="basicInfoPhone" {...warningFor('phone')}>
            <input id="basicInfoPhone" name="phone" type="tel" maxLength={32} defaultValue={basicInfo.phone ?? ''} />
          </WireFormField>
          <WireFormField label="이메일" htmlFor="basicInfoEmail" {...warningFor('email')}>
            <input id="basicInfoEmail" name="email" type="email" maxLength={200} defaultValue={basicInfo.email ?? ''} />
          </WireFormField>
          {/* 레인 D: 등록 화면(register-form)과 **같은 부품**을 쓴다. 두 화면이 같은 값을
              다르게 받으면 다음 수정에서 갈라진다. 도움말은 WireFormField 의 hint 슬롯이
              그리고, DateTextInput 이 aria-describedby 로 그것을 가리킨다(KRDS). */}
          <WireFormField label="생년월일" htmlFor="basicInfoBirthDate" hint={DATE_TEXT_HINT} {...warningFor('birthDate')}>
            <DateTextInput
              id="basicInfoBirthDate"
              name="birthDate"
              defaultValue={basicInfo.birthDate ?? ''}
              autoComplete="bday"
              /* 이 문자열은 WireFormField 가 htmlFor 에서 만드는 `${htmlFor}-hint` 와
                 손으로 맞춘 값이다. 위 htmlFor 를 바꾸면 여기도 함께 바꿔야 한다 —
                 안 바꾸면 도움말 연결만 조용히 끊기고 테스트는 통과한다. */
              describedBy="basicInfoBirthDate-hint"
            />
          </WireFormField>
        </div>
        <hr className="wire-card-divider" />
        <div className="wire-card-title"><h2>추가 정보</h2></div>
        <div className="wire-form-grid">
          <WireFormField label="주소 또는 거주지역" htmlFor="basicInfoRegion" {...warningFor('region')}>
            <input id="basicInfoRegion" name="region" type="text" maxLength={200} defaultValue={basicInfo.region ?? ''} />
          </WireFormField>
          <WireFormField label="성별" control="select" htmlFor="basicInfoGender" {...warningFor('gender')}>
            <select id="basicInfoGender" name="gender" defaultValue={basicInfo.gender ?? ''}>
              {GENDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </WireFormField>
          <WireFormField
            label="계좌번호"
            htmlFor="basicInfoAccount"
            hint="지원금 입금 계좌입니다. 은행과 번호를 함께 적습니다."
            {...warningFor('account')}
          >
            <input id="basicInfoAccount" name="account" type="text" maxLength={100} defaultValue={basicInfo.account ?? ''} />
          </WireFormField>
          {/* 기타는 **자리만**이다(서명 동의서 첨부 자리와 같은 원칙 — 저장되는 척하면
              실무자가 적은 메모가 조용히 사라진다). 금고 컬럼·게이트웨이가 생기면 연다. */}
          <WireFormField
            label="기타"
            note="(준비 중)"
            htmlFor="basicInfoEtc"
            hint="메모 칸은 준비 중입니다. 아직 저장되지 않습니다."
          >
            <input id="basicInfoEtc" name="etc" type="text" disabled />
          </WireFormField>
        </div>
      </WireCard>
    </form>
  );
}
