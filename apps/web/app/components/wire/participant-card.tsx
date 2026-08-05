import Link from 'next/link';
import { Chevron } from './chevron';

// 당사자 카드 (2026-08-06 Q · D60 후속) — **일정 카드와 당사자 목록 카드가 같은 부품이다.**
//
//  1행(일정 화면만): 날짜 · 시간 · 상담 종류 뱃지(+지난 일정 상태 뱃지)
//  2행(공통):       이름 · 가명 ID · 연락처 (· 이메일 — 목록 API 가 아직 안 준다, 자리만)
//
// 규칙(2026-08-06 Q):
//  - 글자는 전부 16/400 로 통일한다. 색만 가른다 — 이름은 --ink, 보조 값은 --sub.
//  - 칸은 카드 장폭에 고르게 편다(space-between) · 카드 안 세로도 가운데 정렬.
//  - 행 사이 구분선은 회색 --line 1px 이고 **카드 아웃라인까지 가로지른다**(풀블리드).
//  - 상태(진행 중·종결)는 뱃지, 참여 사업 N개는 컬러 글자(라벤더 deep — 정보 3색 배분).
//  - 가명 ID 는 카드 정보 표시로 복귀했다(2026-08-06 Q — D59 ② "화면 미표시" 부분 재개정).
//  - 당사자 목록 카드는 오른쪽 끝 화살표(>)가 상세(허브)로 가는 길임을 알린다.

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
  /** 1행 일정 정보. 없으면(당사자 목록) 1행 없는 한 줄 카드가 된다. */
  schedule?: ParticipantCardSchedule | undefined;
  name: string | null;
  beneficiaryId: string;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  /** 케이스 상태 뱃지(진행 중=민트/종결=무채색). 당사자 목록이 쓴다. */
  statusBadge?: { label: string; tone?: 'mint' | undefined } | undefined;
  /** 참여 사업 개수 — 컬러 글자로 표시. */
  programCount?: number | undefined;
  /** 오른쪽 끝 상세 보기 화살표. 당사자 목록이 켠다. */
  chevron?: boolean | undefined;
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
  chevron,
}: ParticipantCardProps) {
  return (
    <Link className="participant-card-link" href={href}>
      <article className="surface-card participant-card">
        {schedule !== undefined && (
          <>
            <div className="participant-card-row">
              <span className="participant-card-cell">{schedule.date}</span>
              <span className="participant-card-cell">{schedule.time}</span>
              <span className="participant-card-badges">
                <span className="wire-badge" data-tone="blue">{schedule.kindLabel}</span>
                {schedule.statusLabel !== undefined && <span className="wire-badge">{schedule.statusLabel}</span>}
              </span>
            </div>
            <hr className="participant-card-divider" />
          </>
        )}
        <div className="participant-card-row">
          {/* 이름 미기입은 회색 '미기입' — ID 칸이 따로 있어 같은 값을 두 번 적지 않는다(D31 폴백 변형). */}
          {name === null || name.length === 0
            ? <span className="participant-card-cell" data-tone="sub">미기입</span>
            : <span className="participant-card-cell">{name}</span>}
          <span className="participant-card-cell" data-tone="sub">{beneficiaryId}</span>
          {phone !== null && phone !== undefined && phone.length > 0 && (
            <span className="participant-card-cell" data-tone="sub">{phone}</span>
          )}
          {email !== null && email !== undefined && email.length > 0 && (
            <span className="participant-card-cell" data-tone="sub">{email}</span>
          )}
          {statusBadge !== undefined && (
            <span className="wire-badge" data-tone={statusBadge.tone}>{statusBadge.label}</span>
          )}
          {programCount !== undefined && (
            <span className="participant-card-programs">참여 사업 {programCount}개</span>
          )}
          {chevron === true && <Chevron dir="right" />}
        </div>
      </article>
    </Link>
  );
}
