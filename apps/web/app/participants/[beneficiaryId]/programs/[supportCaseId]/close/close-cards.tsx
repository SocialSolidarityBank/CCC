'use client';

import { WireBadge } from '../../../../../components/wire/wire-badge';
import { TimeAxisBadge } from '../../../../../components/wire/time-axis-badge';
import { WireButton } from '../../../../../components/wire/wire-button';
import { WireCard, WireField } from '../../../../../components/wire/wire-card';
import { WireFormField } from '../../../../../components/wire/wire-form-field';
import { WireEmpty } from '../../../../../components/wire/wire-state';
import { formatKoreanDate } from '../../../../../lib/format-korean-date';
import type { OpenActionItem, SupportCaseClosureInfo } from '../../../../../lib/api';

// 케이스 종결 화면(CCC-107)의 표현부. 서버 컴포넌트(page.tsx)가 fetch 를 끝낸 순수
// 데이터를 넘기고 여기서는 그리기만 한다 — jsdom 테스트가 server-only 없이 렌더할 수
// 있도록 error-state.tsx 와 같은 이유로 모듈을 갈랐다(CCC-23 패턴).
// 행 문법은 브리핑 '미해결 액션'과 같다(briefing-action-rows) — 같은 데이터의 같은 모양.

const actionOwnerLabels: Record<OpenActionItem['owner'], string> = {
  counselor: '실무자',
  beneficiary: '당사자',
  org: '기관',
};

/** 종결 전 확인 ① — 미해결 액션 아이템. 종결을 막지 않는다: 남은 일을 눈으로 확인시키는 자리다. */
export function OpenActionItemsCard({ items }: { items: OpenActionItem[] }) {
  return (
    <WireCard as="section" title="미해결 액션 아이템" testId="close-open-action-items">
      {items.length === 0
        ? <WireEmpty>미해결 액션 아이템이 없습니다.</WireEmpty>
        : (
          <ul className="briefing-action-rows">
            {items.map((item) => (
              <li key={item.id} className="briefing-action-row">
                <span className="briefing-action-desc">{item.description}</span>
                <WireBadge tone="mint">담당 {actionOwnerLabels[item.owner]}</WireBadge>
                {item.dueDate !== null && (
                  <TimeAxisBadge>기한 {item.dueDate}</TimeAxisBadge>
                )}
              </li>
            ))}
          </ul>
        )}
    </WireCard>
  );
}

/** 종결 전 확인 ② — 아직 열려 있는 세부 목표. 역시 종결을 막지 않는다(닫기 강제는 D62 §5 와 별개). */
export function ActiveGoalsCard({ goals }: { goals: Array<{ id: string; title: string }> }) {
  return (
    <WireCard as="section" title="활성 세부 목표" testId="close-active-goals">
      {goals.length === 0
        ? <WireEmpty>활성 세부 목표가 없습니다.</WireEmpty>
        : (
          <ul className="briefing-action-rows">
            {goals.map((goal) => (
              <li key={goal.id} className="briefing-action-row">
                <span className="briefing-action-desc">{goal.title}</span>
                <WireBadge tone="mint">진행 중</WireBadge>
              </li>
            ))}
          </ul>
        )}
    </WireCard>
  );
}

/**
 * 종결 실행 폼. 사유는 필수이고, 되돌릴 수 없음을 읽었다는 확인 체크 없이는 제출하지
 * 않는다(서버 액션이 같은 검증을 다시 한다). 이름 계약: beneficiaryId·supportCaseId·
 * reason·confirmClose — actions.ts 의 closeSupportCaseAction 이 이 이름으로 읽는다.
 */
export function CaseCloseForm({ beneficiaryId, supportCaseId, action, errorText }: {
  beneficiaryId: string;
  supportCaseId: string;
  action: (formData: FormData) => Promise<void>;
  errorText?: string | undefined;
}) {
  return (
    <WireCard as="section" title="케이스 종결" testId="close-form-card">
      <form action={action} className="close-case-stack">
        <input type="hidden" name="beneficiaryId" value={beneficiaryId} />
        <input type="hidden" name="supportCaseId" value={supportCaseId} />
        <p>
          종결하면 이 케이스의 지원 기록이 닫히고, 당사자의 마지막 진행 중 케이스라면
          개인정보 보관 기간이 시작됩니다(파기 예정일은 규정에 따라 자동 계산). 종결은
          이 화면에서 되돌릴 수 없습니다.
        </p>
        <WireFormField label="종결 사유" required control="textarea" htmlFor="close-reason">
          <textarea id="close-reason" name="reason" rows={4} required placeholder="종결 사유를 입력하세요." />
        </WireFormField>
        <label className="consent-checkbox">
          <input type="checkbox" className="wire-checkbox" name="confirmClose" value="on" required />
          <span>위 내용을 확인했고, 이 케이스를 종결합니다.</span>
        </label>
        {errorText !== undefined && (
          <p className="wire-field-error" role="alert">{errorText}</p>
        )}
        <div>
          <WireButton type="submit" variant="danger">케이스 종결</WireButton>
        </div>
      </form>
    </WireCard>
  );
}

/**
 * 이미 종결된 케이스의 읽기 전용 요약 — 상태·종결일·사유·파기 예정일(purge_due).
 * 파기 예정일이 비어 있는 두 경우를 말로 가른다: 다른 진행 중 케이스가 남아 보관 기간이
 * 아직 시작되지 않았거나, 이미 파기가 끝났다. 파기 실행 자체는 CCC-113 소관이라 여기서는
 * 표시만 한다 — 이 화면은 아무 값도 쓰지 않는다.
 */
export function ClosedCaseSummary({ info }: { info: SupportCaseClosureInfo }) {
  return (
    <WireCard as="section" title="종결 정보" testId="closed-case-summary">
      <div className="close-case-stack">
        <WireField label="상태"><WireBadge>종결</WireBadge></WireField>
        <WireField label="종결일">
          {info.closedAt === null ? '-' : formatKoreanDate(info.closedAt)}
        </WireField>
        <WireField label="종결 사유">{info.closedReason ?? '-'}</WireField>
        <WireField label="파기 예정일">
          <span data-testid="closed-purge-due">
            {info.purgedAt !== null
              ? `개인정보 파기 완료 (${formatKoreanDate(info.purgedAt)})`
              : info.purgeDue !== null
                ? formatKoreanDate(info.purgeDue)
                : info.hasOtherActiveSupportCase
                  ? '다른 진행 중 케이스가 있어 보관 기간이 아직 시작되지 않았습니다.'
                  : '-'}
          </span>
        </WireField>
      </div>
    </WireCard>
  );
}
