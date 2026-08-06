import Link from 'next/link';

// 당사자 카드 (2026-08-06 Q · D60 후속) — **일정 카드와 당사자 목록 카드가 같은 부품이다.**
//
//  1행: 일정 화면 = 날짜 · 시간 · 종류 뱃지(+지난 일정 상태 뱃지)
//       당사자 목록 = 참여 사업 N개 · 상태 뱃지(진행 중·종결) — 같은 날 3차: 목록도
//       한 줄 카드가 아니라 **일정 카드와 같은 2행 골격**을 쓴다(구 '2행 오른쪽 묶음' 대체).
//  2행(공통): 이름 · 가명 ID · 연락처 (· 이메일 — 보류, D24 확장 대기. 자리만)
//
// 규칙(2026-08-06 Q, 같은 날 2·3·5차 개정):
//  - 칸은 **앞 아이템을 따라 붙는 좌측정렬**이다(5차 — 구 고정 폭 칸 대체: 가명 ID 가
//    길어지면 고정 96px 칸 안에서 줄바꿈해 답답했다). 날짜 옆 시간도 같은 원리로 밀착한다.
//    1행 틈은 12, 2행(정보 칸) 틈은 20 — 값 사이 여백을 한 단 넓힌다.
//  - 이름만 강조(600 + 광학 1px 확대), 나머지는 16/400. 가명 ID 는 연락처보다 옅은
//    그레이다(3차 — 대조용 값이라 한 발 물러선다).
//  - 뱃지는 행 오른쪽 끝, 정보 값은 왼쪽 고정 칸 — 두 축이 섞이지 않는다.
//  - 행 사이 구분선은 회색 --line 1px 이고 **카드 아웃라인까지 가로지른다**(풀블리드).
//  - 상태(진행 중·종결)는 뱃지, 참여 사업 N개는 컬러 글자(라벤더 deep — 정보 3색 배분).
//  - 가명 ID 는 카드 정보 표시로 복귀했다(2026-08-06 Q — D59 ② "화면 미표시" 부분 재개정).
//  - 화살표(>)는 없다(같은 날 4차 — 구 '목록 카드 오른쪽 끝 화살표' 폐지). 카드 전체가
//    링크이고, 호버 그라데이션 아웃라인이 눌림을 알린다 — 일정 카드와 같은 문법이다.

export interface ParticipantCardSchedule {
  /** "8월 7일 (금)" */
  date: string;
  /** "14:00" */
  time: string;
  /** 상담 종류(인테이크/기본 상담) — 블루 계열 뱃지(일정 축, D34). */
  kindLabel: string;
  /** 지난 일정의 상태(완료/취소/불참) — 무채색 뱃지. 예정에는 붙이지 않는다. */
  statusLabel?: string | undefined;
}

export interface ParticipantCardProps {
  href: string;
  /** 1행 일정 정보(일정 화면). 없으면 당사자 목록의 1행(참여 사업·상태)이 대신 선다. */
  schedule?: ParticipantCardSchedule | undefined;
  name: string | null;
  beneficiaryId: string;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  /** 케이스 상태 뱃지(진행 중=민트/종결=무채색). 당사자 목록이 쓴다. */
  statusBadge?: { label: string; tone?: 'mint' | undefined } | undefined;
  /** 참여 사업 개수 — 컬러 글자로 표시. */
  programCount?: number | undefined;
}

export function ParticipantCard({
  href,
  schedule,
  name,
  beneficiaryId,
  phone,
  email,
  statusBadge,
  programCount,
}: ParticipantCardProps) {
  return (
    <Link className="participant-card-link" href={href}>
      <article className="surface-card participant-card">
        {schedule !== undefined && (
          <>
            <div className="participant-card-row">
              <span className="participant-card-cell" data-col="date">{schedule.date}</span>
              <span className="participant-card-cell">{schedule.time}</span>
              <span className="participant-card-badges">
                <span className="wire-badge" data-tone="blue">{schedule.kindLabel}</span>
                {schedule.statusLabel !== undefined && <span className="wire-badge">{schedule.statusLabel}</span>}
              </span>
            </div>
            <hr className="wire-card-divider" />
          </>
        )}
        {schedule === undefined && (statusBadge !== undefined || programCount !== undefined) && (
          <>
            <div className="participant-card-row">
              {programCount !== undefined && (
                <span className="participant-card-programs">참여 사업 {programCount}개</span>
              )}
              {statusBadge !== undefined && (
                <span className="participant-card-badges">
                  <span className="wire-badge" data-tone={statusBadge.tone}>{statusBadge.label}</span>
                </span>
              )}
            </div>
            <hr className="wire-card-divider" />
          </>
        )}
        <div className="participant-card-row" data-row="info">
          {/* 이름 미기입은 회색 '미기입' — ID 칸이 따로 있어 같은 값을 두 번 적지 않는다(D31 폴백 변형). */}
          {name === null || name.length === 0
            ? <span className="participant-card-cell" data-col="name" data-tone="sub">미기입</span>
            : <span className="participant-card-cell" data-col="name">{name}</span>}
          <span className="participant-card-cell" data-col="id">{beneficiaryId}</span>
          {phone !== null && phone !== undefined && phone.length > 0 && (
            <span className="participant-card-cell" data-tone="sub">{phone}</span>
          )}
          {email !== null && email !== undefined && email.length > 0 && (
            <span className="participant-card-cell" data-tone="sub">{email}</span>
          )}
        </div>
      </article>
    </Link>
  );
}
