'use client';

import { useState } from 'react';
import { AdminSidebar } from '../components/wire/admin-sidebar';
import { RiskBanner } from '../participants/[beneficiaryId]/programs/[supportCaseId]/briefing/risk-banner';
import { GridContainer } from '../components/wire/grid-container';
import { ListRow } from '../components/wire/list-row';
import { PageTitle } from '../components/wire/page-title';
import { SearchInput } from '../components/wire/search-input';
import { WireBullets, WireCard, WireField } from '../components/wire/wire-card';
import { WireChoice, WireFormField } from '../components/wire/wire-form-field';
import { WireButton } from '../components/wire/wire-button';
import { PROGRAM_LABELS } from '../lib/labels';

// #31 컴포넌트 킷 검수용 데모. 전 컴포넌트를 변형까지 나열한다. 스타일 검수 전용이라
// 실제 데이터·게이트웨이 호출은 없다(R1 무관). 의도적으로 어느 메뉴에도 링크하지 않는
// 와이어 킷 데모 라우트(dev 전용) — 프로덕션 내비게이션에서 접근할 수 없다.
export default function KitPage() {
  const [accordionOpen, setAccordionOpen] = useState(true);
  const [selectedRow, setSelectedRow] = useState('first');
  const [search, setSearch] = useState('');
  const [program, setProgram] = useState('financial_support_v1');

  return (
    <main className="page-content">
      <GridContainer>
        <PageTitle>컴포넌트 킷</PageTitle>

        <section className="wire-kit-section" aria-labelledby="kit-tokens">
          <h2 className="wire-kit-heading" id="kit-tokens">레이아웃과 색 토큰</h2>
          <p className="wire-kit-caption">
            콘텐츠 컬럼 1120(폼·읽기 화면은 720), 좌우 여백 32, 섹션 간격 32. 값은 design/tokens.css 의
            --page-max · --page-pad-x · --section-gap 하나뿐이고 화면이 폭을 따로 정하지 않는다 (DESIGN.md 4-1)
          </p>
          <div className="wire-container" data-grid="true">
            <div className="wire-col-6 wire-kit-swatch">col-6</div>
            <div className="wire-col-6 wire-kit-swatch">col-6</div>
            <div className="wire-col-4 wire-kit-swatch">col-4</div>
            <div className="wire-col-4 wire-kit-swatch">col-4</div>
            <div className="wire-col-4 wire-kit-swatch">col-4</div>
            <div className="wire-col-8 wire-kit-swatch">col-8</div>
            <div className="wire-col-4 wire-kit-swatch">col-4</div>
          </div>
        </section>

        <section className="wire-kit-section" aria-labelledby="kit-cardgrid">
          <h2 className="wire-kit-heading" id="kit-cardgrid">카드 목록 (.card-grid)</h2>
          <p className="wire-kit-caption">
            카드가 1장이면 폭 전체, 늘어나면 --grid-min(420) 기준으로 열이 갈린다. auto-fit 이라 빈 칸을 남기지 않는다
          </p>
          <div className="card-grid">
            <div className="wire-kit-swatch">카드 1</div>
            <div className="wire-kit-swatch">카드 2</div>
            <div className="wire-kit-swatch">카드 3</div>
          </div>
        </section>

        <section className="wire-kit-section" aria-labelledby="kit-listrow">
          <h2 className="wire-kit-heading" id="kit-listrow">ListRow</h2>
          <p className="wire-kit-caption">체브론 down, right, none, selected(그라데이션 채움 — 체크박스 켬과 같은 어휘), 아코디언 토글, 링크</p>
          <div className="wire-kit-stack">
            <ListRow chevron="down">체브론 down (펼침)</ListRow>
            <ListRow chevron="right">체브론 right (이동/접힘)</ListRow>
            <ListRow>체브론 없음</ListRow>
            <ListRow align="center">중앙 정렬</ListRow>
            <ListRow
              selected={selectedRow === 'first'}
              onClick={() => setSelectedRow('first')}
            >
              선택 가능 로우 A (selected)
            </ListRow>
            <ListRow
              selected={selectedRow === 'second'}
              onClick={() => setSelectedRow('second')}
            >
              선택 가능 로우 B
            </ListRow>
            <ListRow href="/kit" chevron="right">링크 로우 (/kit)</ListRow>
            <ListRow
              open={accordionOpen}
              onClick={() => setAccordionOpen((prev) => !prev)}
              ariaExpanded={accordionOpen}
              ariaControls="kit-accordion-body"
            >
              아코디언 헤더 (open={String(accordionOpen)})
            </ListRow>
            {accordionOpen && (
              <div id="kit-accordion-body">
                <WireCard>펼쳐진 아코디언 본문</WireCard>
              </div>
            )}
          </div>
        </section>

        <section className="wire-kit-section" aria-labelledby="kit-card">
          <h2 className="wire-kit-heading" id="kit-card">WireCard (2열)</h2>
          <div className="wire-container" data-grid="true" style={{ padding: 0 }}>
            <div className="wire-col-6">
              <WireCard title="개인정보">
                {/* D31: 화면은 실명 기본(마스킹 표기 데모도 제거). 예시는 가상 인물. */}
                <WireField label="이름">김서준</WireField>
                <WireField label="연락처">010-0000-1234</WireField>
                <WireField label="계좌">국민 000000-00-000000</WireField>
              </WireCard>
            </div>
            <div className="wire-col-6">
              <WireCard title="오늘 확인할 질문">
                <WireBullets items={['지난주 구직 활동은 어땠는지', '월세 납부 일정은 정리됐는지']} />
              </WireCard>
            </div>
          </div>
          <WireCard>타이틀 없는 카드, 본문만.</WireCard>
        </section>

        <section className="wire-kit-section" aria-labelledby="kit-search">
          <h2 className="wire-kit-heading" id="kit-search">SearchInput</h2>
          <div className="wire-kit-stack">
            <SearchInput
              label="당사자 검색"
              name="kit-search"
              placeholder="가명 ID 또는 이름"
              value={search}
              onChange={setSearch}
            />
            <SearchInput
              label="참여 사업"
              variant="select"
              name="kit-program"
              value={program}
              onChange={setProgram}
              options={[
                { value: 'financial_support_v1', label: PROGRAM_LABELS.financial_support_v1 },
                { value: 'all', label: '전체' },
              ]}
            />
          </div>
        </section>

        <section className="wire-kit-section" aria-labelledby="kit-form-field">
          <h2 className="wire-kit-heading" id="kit-form-field">WireFormField · WireChoice</h2>
          <p className="wire-kit-caption">
            검색칸과 같은 입력칸 계약(높이 40 · radius 6 · --line-control 1px)을 폼에서 쓰는 형태다.
            라벨은 항상 위, 필수는 별표, 오류는 테두리 1.5px --risk + 메시지를 함께 낸다.
            선택지 행은 동그라미와 라벨이 같은 줄이고 입력칸 규칙을 상속하지 않는다.
          </p>
          <div className="wire-kit-stack">
            <WireFormField label="이름" required htmlFor="kit-name">
              <input id="kit-name" type="text" placeholder="예: 김미영" />
            </WireFormField>
            <WireFormField label="상담 유형" control="select" htmlFor="kit-kind">
              <select id="kit-kind" defaultValue="regular">
                <option value="intake">인테이크</option>
                <option value="regular">정기 상담</option>
              </select>
            </WireFormField>
            <WireFormField label="수기 메모" control="textarea" htmlFor="kit-memo" hint="도움말은 입력칸 아래에 둔다.">
              <textarea id="kit-memo" rows={3} />
            </WireFormField>
            <WireFormField label="연락처" htmlFor="kit-phone" error="숫자만 입력하세요.">
              <input id="kit-phone" type="text" defaultValue="연락처" />
            </WireFormField>
            <fieldset className="wire-fieldset">
              <legend>처리 상태 <small>(선택지 행)</small></legend>
              <div className="wire-choice-group">
                <WireChoice label="미처리" type="radio" name="kit-resolution" defaultChecked />
                <WireChoice label="완료" type="radio" name="kit-resolution" />
                <WireChoice label="진행 중" type="radio" name="kit-resolution" />
                <WireChoice label="보류" type="radio" name="kit-resolution" disabled />
              </div>
              <div className="wire-choice-group" data-layout="stack">
                <WireChoice label="녹음 동의" type="checkbox" desc="음성 분석에 사용합니다." />
                <WireChoice label="위기 발언" type="checkbox" tone="risk" />
              </div>
            </fieldset>
          </div>
        </section>

        <section className="wire-kit-section" aria-labelledby="kit-button">
          <h2 className="wire-kit-heading" id="kit-button">버튼 4종 × 크기 2단</h2>
          <p className="wire-kit-caption">
            종류가 색과 테두리를 정하고, 크기는 높이만 바꾼다(40 / 32). 2026-07-26 Q 결정.
          </p>
          <p className="wire-kit-caption">
            2026-07-31: 프라이머리와 세컨더리는 <strong>테두리가 같다</strong>. 강조는 면(그라데이션)과
            그림자가 만든다. 마우스를 올리면 잉크 워시가 깔리고, 누르면 1px 내려간다.
          </p>
          <div className="wire-kit-row">
            <WireButton variant="primary" align="center">프라이머리</WireButton>
            <WireButton variant="secondary" align="center">세컨더리</WireButton>
            <WireButton variant="ghost" align="center">고스트</WireButton>
            <WireButton variant="danger" align="center">위험</WireButton>
            <WireButton disabled align="center">비활성</WireButton>
          </div>
          <div className="wire-kit-row">
            <WireButton variant="primary" height="sm" align="center">프라이머리 32</WireButton>
            <WireButton variant="secondary" height="sm" align="center">기록에 추가</WireButton>
            <WireButton variant="ghost" height="sm" align="center">넘어가기</WireButton>
            <WireButton variant="danger" height="sm" align="center">삭제</WireButton>
          </div>
          <div className="wire-kit-stack">
            <WireButton size="large" chevron>대형 + 체브론 (프라이머리로 해석)</WireButton>
            <WireButton href="/kit" chevron>링크 버튼 (/kit)</WireButton>
          </div>
        </section>

        <section className="wire-kit-section" aria-labelledby="kit-badge">
          <h2 className="wire-kit-heading" id="kit-badge">배지와 상태 태그</h2>
          <p className="wire-kit-caption">
            기본형은 색 없이 테두리로만 선다. 계열 배지는 tint 배경 + deep 글자이고, 주의와 대기는 라벤더다.
          </p>
          <div className="wire-kit-row">
            <span className="wire-badge">공식 기록</span>
            <span className="wire-badge" data-tone="mint">마이크로크레딧</span>
            <span className="wire-badge" data-tone="lavender">승인 대기 2건</span>
            <span className="wire-badge" data-tone="blue">3회차</span>
            <button type="button" className="wire-status-tag">상담 준비</button>
          </div>
        </section>

        <section className="wire-kit-section" aria-labelledby="kit-checkbox">
          <h2 className="wire-kit-heading" id="kit-checkbox">체크박스</h2>
          <p className="wire-kit-caption">
            기본은 민트에서 라벤더로 흐르는 deep 그라데이션 테두리다. 리스크 변형은 테두리만 바꾼다. 2026-07-26 Q 결정.
          </p>
          <p className="wire-kit-caption">
            2026-07-31: <strong>켜면 면이 칠해진다</strong>. 예전에는 12px 체크 표시 하나로만 갈려서
            훑을 때 켜짐과 꺼짐이 구분되지 않았다. 채움은 프라이머리 버튼과 같은 그라데이션이고,
            리스크 변형도 채움은 같고 테두리만 리스크 색이다. 아래 네 칸을 나란히 두고 비교한다.
          </p>
          <div className="wire-kit-stack">
            <label className="consent-checkbox">
              <input type="checkbox" className="wire-checkbox" defaultChecked />
              AI를 활용한 녹취기록 동의 (켬)
            </label>
            <label className="consent-checkbox">
              <input type="checkbox" className="wire-checkbox" />
              개인정보 수집·이용 동의 (끔)
            </label>
            <label className="consent-checkbox">
              <input type="checkbox" className="wire-checkbox" data-tone="risk" defaultChecked />
              부채 악화 (리스크 변형 · 켬)
            </label>
            <label className="consent-checkbox">
              <input type="checkbox" className="wire-checkbox" data-tone="risk" />
              연락 두절 위험 (리스크 변형 · 끔)
            </label>
          </div>
        </section>

        {/* 그라데이션 테두리를 쓰는 표면 3종. 킷에 없던 자리인데, 이 셋이 **다크에서 가장 깨지기
            쉬운 부품**이다 — 배경 2겹(padding-box 채움 + border-box 그라데이션)으로 만들어져
            채움색 토큰이 다크에서 안 따라오면 테두리가 안쪽까지 번지거나 아예 사라진다.
            눈으로 볼 자리가 없으면 회귀를 잡을 방법도 없다(2026-07-31). */}
        <section className="wire-kit-section" aria-labelledby="kit-gradient-surfaces">
          <h2 className="wire-kit-heading" id="kit-gradient-surfaces">그라데이션 테두리 3종</h2>
          <p className="wire-kit-caption">
            리스크 배너(1.5px · 전용 tint 채움), 펼친 회차 카드(1px · 흰 면 채움), 위기 아코디언(리스크 1.5px).
            셋 다 <code>border-image</code> 가 아니라 배경 2겹으로 만든다 — <code>border-image</code> 는
            브라우저가 <code>border-radius</code> 를 무시해 모서리가 각진다.
          </p>
          <div className="wire-kit-stack">
            <RiskBanner
              flags={[
                { id: 'kit-1', flagType: 'debt_deterioration', source: 'ai', reviewStatus: 'confirmed' },
                { id: 'kit-2', flagType: 'contact_loss_risk', source: 'counselor', reviewStatus: 'confirmed' },
                { id: 'kit-3', flagType: 'crisis_utterance', source: 'ai', reviewStatus: 'pending' },
              ]}
            />
            <details className="surface-card" open>
              <summary className="record-summary">
                <span className="record-ordinal">3회차</span>
                <span className="record-held-at">3월 12일</span>
                <span className="record-kind">기본 상담</span>
                <span className="record-one-liner">상환 계획을 다시 짰고 다음 달 임대료 납부일을 확인했다.</span>
              </summary>
              <div className="record-body">
                <div className="record-session-goal">
                  <span className="record-session-goal-label">이번 상담의 목표</span>
                  <p>임대료 연체를 막을 방법을 함께 정한다.</p>
                </div>
              </div>
            </details>
            <details className="record-accordion is-crisis" open>
              <summary className="record-accordion-summary">위기·안전 확인</summary>
              <div className="record-accordion-body">
                <p className="wire-kit-caption">확인된 리스크와 같은 축이라 리스크 균일 테두리 + 배경 틴트로 표시한다(D9).</p>
              </div>
            </details>
          </div>
        </section>

        <section className="wire-kit-section" aria-labelledby="kit-tabs">
          <h2 className="wire-kit-heading" id="kit-tabs">탭</h2>
          <p className="wire-kit-caption">활성은 색이 아니라 대비로 구분한다. 검토와 승인 화면에서 쓴다.</p>
          <div className="wire-tabs" role="tablist">
            <button type="button" className="wire-tab" role="tab" aria-selected="true">전사 대조</button>
            <button type="button" className="wire-tab" role="tab" aria-selected="false">화자 매핑</button>
            <button type="button" className="wire-tab" role="tab" aria-selected="false">GAS 근거</button>
          </div>
        </section>

        <section className="wire-kit-section" aria-labelledby="kit-quote">
          <h2 className="wire-kit-heading" id="kit-quote">인용 블록</h2>
          <p className="wire-kit-caption">
            AI 제안의 근거 발언 전용이다. 세로선은 브랜드 그라데이션이고 회색 세로선을 쓰지 않는다.
          </p>
          <blockquote className="wire-quote">
            이번 달은 상환액을 맞췄는데 다음 달이 걱정이라고 하셨어요.
            <span className="wire-quote-time">12:04</span>
          </blockquote>
        </section>

        <section className="wire-kit-section" aria-labelledby="kit-empty">
          <h2 className="wire-kit-heading" id="kit-empty">빈 상태</h2>
          <p className="wire-kit-caption">무채색만 쓴다. 라인 아이콘, 제목, 설명, 다음 행동 버튼 순.</p>
          <WireCard>
            <div className="wire-empty">
              <svg className="wire-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M8 3v4M16 3v4M3 11h18" />
              </svg>
              <p className="wire-empty-title">예정된 상담이 없습니다</p>
              <p className="wire-empty-desc">상담을 등록하면 이 자리에 날짜별로 모입니다.</p>
              <WireButton variant="secondary" height="sm" align="center" href="/schedules/new">상담 등록</WireButton>
            </div>
          </WireCard>
        </section>

        <section className="wire-kit-section" aria-labelledby="kit-modal">
          <h2 className="wire-kit-heading" id="kit-modal">모달</h2>
          <p className="wire-kit-caption">
            폭 520. 하단은 오른쪽 정렬이고 세컨더리가 왼쪽, 프라이머리가 오른쪽 끝이다. 스크림 없이 형태만 보여준다.
          </p>
          <div className="wire-modal">
            <p className="wire-modal-title">이 기록을 공식 기록으로 승인할까요?</p>
            <p className="wire-modal-desc">승인하면 브리핑과 통계에 반영됩니다.</p>
            <div className="wire-modal-body">
              <p className="wire-kit-caption">대조 결과 3종을 모두 확인했습니다.</p>
            </div>
            <div className="wire-modal-actions">
              <WireButton variant="secondary" align="center">돌아가기</WireButton>
              <WireButton variant="primary" align="center">승인</WireButton>
            </div>
          </div>
        </section>

        <section className="wire-kit-section" aria-labelledby="kit-input-states">
          <h2 className="wire-kit-heading" id="kit-input-states">입력칸 3상태</h2>
          <p className="wire-kit-caption">
            라벨은 항상 위에 둔다. 오류는 테두리 색과 메시지 텍스트를 함께 둔다.
          </p>
          <div className="wire-kit-stack">
            <div className="wire-search">
              <span className="wire-search-label">이름</span>
              <div className="wire-search-box">
                <input readOnly value="김서준" aria-label="이름 기본 상태" />
              </div>
            </div>
            <div className="wire-search">
              <span className="wire-search-label">연락처</span>
              <div className="wire-search-box" data-invalid="true">
                <input readOnly value="010-000" aria-label="연락처 오류 상태" aria-invalid="true" />
              </div>
              <p className="wire-field-error">연락처를 11자리로 입력하세요.</p>
            </div>
          </div>
        </section>

        <section className="wire-kit-section" aria-labelledby="kit-admin">
          <h2 className="wire-kit-heading" id="kit-admin">AdminSidebar</h2>
          <p className="wire-kit-caption">활성 항목은 bold. 링크만 있고 페이지는 이후 티켓.</p>
          <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-card)', overflow: 'hidden', maxWidth: 335 }}>
            <AdminSidebar activePath="/admin/users" />
          </div>
        </section>
      </GridContainer>
    </main>
  );
}
