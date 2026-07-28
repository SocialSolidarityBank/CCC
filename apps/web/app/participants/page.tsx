import Link from 'next/link';
import { ApiError, listAssignedParticipants, type AssignedParticipant } from '../lib/api';
import { GridContainer } from '../components/wire/grid-container';
import { ListRow } from '../components/wire/list-row';
import { MetaRow } from '../components/wire/meta-row';
import { PageTitle } from '../components/wire/page-title';
import { ParticipantName } from '../components/wire/participant-name';
import { WireButton } from '../components/wire/wire-button';
import { ParticipantFilter } from './participant-filter';

// 사이드바 '참여자' 메뉴의 도착지 (D35 · ADR-0014 §2·§3). 여기서 참여자를 고르면
// 참여자 정보 페이지(허브)로 간다.
//
// 이 목록은 **사업 워크스페이스 범위를 벗어난다** — 사람은 사업보다 크기 때문이다(§3).
// 그래서 사업별로 거르지 않고 담당 중인 참여자 전원을 한 번에 보여준다.
//
// **케이스 상태로도 거르지 않는다**(CCC-17): 종결 케이스만 남은 참여자가 허브 입구에서
// 사라지면 다시 들여다볼 방법이 없다. 접근 범위·감사는 게이트웨이가 강제한다(R1 · D7 · D14).
//
// 찾기는 D21의 '상단 참여자 검색'이 갈 곳을 잃어(상단 헤더 폐기, CCC-18a) 여기로 왔다.
// 서버 검색이 아니라 이미 받은 목록을 좁히는 방식이다 — 담당 참여자는 수십 명 규모라
// 왕복을 더할 이유가 없고, 오타에도 목록이 사라지지 않는다.

function statusLabel(status: AssignedParticipant['status']): string {
  return status === 'active' ? '진행 중' : '종결';
}

export default async function ParticipantsPage() {
  let participants: AssignedParticipant[] = [];
  let loadError: string | null = null;
  try {
    participants = await listAssignedParticipants();
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    loadError = '참여자 목록을 불러올 수 없습니다. 접근 권한을 확인하세요.';
  }

  // 이름 순. 실명이 없으면 가명 ID 로 자리를 잡는다(D31 폴백).
  const sorted = [...participants].sort((a, b) =>
    (a.name ?? a.beneficiaryId).localeCompare(b.name ?? b.beneficiaryId, 'ko'));

  return (
    <main className="page-content">
      <GridContainer>
        {/* 축은 사이드바=장소 / 페이지 우상단=행동이다(§2). 등록은 행동이라 여기 남는다. */}
        <div className="page-header">
          <PageTitle>참여자</PageTitle>
          <div className="page-actions">
            <WireButton href="/participants/new" variant="primary">참여자 등록</WireButton>
          </div>
        </div>
        {loadError !== null ? (
          <p className="empty" role="alert">{loadError}</p>
        ) : sorted.length === 0 ? (
          <p className="empty">담당 중인 참여자가 없습니다. 참여자를 먼저 등록하세요.</p>
        ) : (
          <ParticipantFilter
            rows={sorted.map((entry) => ({
              beneficiaryId: entry.beneficiaryId,
              // 검색어 대조용 문자열. 이름·가명 ID·연락처를 한 줄로 이어 둔다.
              haystack: [entry.name ?? '', entry.beneficiaryId, entry.phone ?? ''].join(' ').toLowerCase(),
              node: (
                <ListRow href={`/participants/${encodeURIComponent(entry.beneficiaryId)}`}>
                  <span style={{ display: 'grid', gap: 4 }}>
                    <ParticipantName name={entry.name} beneficiaryId={entry.beneficiaryId} />
                    <MetaRow
                      items={[
                        statusLabel(entry.status),
                        `참여 사업 ${entry.programCount}개`,
                        ...(entry.phone === null || entry.phone.length === 0 ? [] : [entry.phone]),
                      ]}
                    />
                  </span>
                </ListRow>
              ),
            }))}
          />
        )}
        {/* 참여자 초대(D26 스텁)의 유일한 진입점이었던 프로필 드롭다운이 헤더와 함께
            사라졌다. 초대는 '행동'이라 이 페이지에 남되, 아직 발송이 없는 스텁이라
            주 버튼과 겨루지 않게 본문 아래 보조 링크로 둔다. */}
        <p className="note-inline">
          참여자가 직접 정보를 입력하게 하려면 <Link href="/participants/invite">참여자 초대</Link>를 쓰세요.
        </p>
      </GridContainer>
    </main>
  );
}
