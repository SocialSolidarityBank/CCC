'use client';

import { WireCard } from '../../../components/wire/wire-card';
import { WireButton } from '../../../components/wire/wire-button';
import { WireFormField } from '../../../components/wire/wire-form-field';
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
 * 빈 칸으로 저장하면 그 항목은 금고에서 지워진다.
 */
export function BasicInfoForm({ basicInfo, action }: BasicInfoFormProps) {
  return (
    <form action={action}>
      {/* 낙관적 잠금 + 쓰기 컨텍스트. 둘 다 서버가 정해 준 값을 그대로 돌려보낸다 —
          화면이 참여 사업을 고르지 않는다. */}
      <input type="hidden" name="beneficiaryId" value={basicInfo.beneficiaryId} />
      <input type="hidden" name="supportCaseContextId" value={basicInfo.supportCaseContextId} />
      <input type="hidden" name="expectedVersion" value={String(basicInfo.version)} />
      <WireCard className="wire-form-card" title={<h2>기본정보</h2>}>
        <div className="wire-form-grid">
          <WireFormField label="이름" htmlFor="basicInfoName">
            <input id="basicInfoName" name="name" type="text" maxLength={100} defaultValue={basicInfo.name ?? ''} />
          </WireFormField>
          <WireFormField label="휴대전화" htmlFor="basicInfoPhone">
            <input id="basicInfoPhone" name="phone" type="tel" maxLength={32} defaultValue={basicInfo.phone ?? ''} />
          </WireFormField>
          <WireFormField label="이메일" htmlFor="basicInfoEmail">
            <input id="basicInfoEmail" name="email" type="email" maxLength={200} defaultValue={basicInfo.email ?? ''} />
          </WireFormField>
          <WireFormField label="생년월일" htmlFor="basicInfoBirthDate">
            <input
              id="basicInfoBirthDate"
              name="birthDate"
              type="date"
              defaultValue={basicInfo.birthDate ?? ''}
            />
          </WireFormField>
          <WireFormField label="주소 또는 거주지역" htmlFor="basicInfoRegion">
            <input id="basicInfoRegion" name="region" type="text" maxLength={200} defaultValue={basicInfo.region ?? ''} />
          </WireFormField>
          <WireFormField label="성별" control="select" htmlFor="basicInfoGender">
            <select id="basicInfoGender" name="gender" defaultValue={basicInfo.gender ?? ''}>
              {GENDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </WireFormField>
          <WireFormField
            label="계좌"
            htmlFor="basicInfoAccount"
            hint="지원금 입금 계좌입니다. 은행과 번호를 함께 적습니다."
          >
            <input id="basicInfoAccount" name="account" type="text" maxLength={100} defaultValue={basicInfo.account ?? ''} />
          </WireFormField>
        </div>
        <p className="wire-form-hint">
          빈 칸으로 저장하면 그 항목은 지워집니다. 저장 기록은 감사 로그에 남습니다.
        </p>
        <div className="wire-form-actions">
          <WireButton type="submit" variant="primary">저장</WireButton>
        </div>
      </WireCard>
    </form>
  );
}
