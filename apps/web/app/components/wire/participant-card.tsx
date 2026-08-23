import { WireBadge } from './wire-badge';
import { WireField } from './wire-card';
import Link from 'next/link';

// 당사자 카드. 일정 화면과 당사자 목록이 같은 골격을 쓰고 화면 맥락에 맞는 필드만 바꾼다.
//
// 공통 헤더: 이름과 가명 ID는 왼쪽, 현재 화면에서 가장 중요한 분류·상태 배지는 오른쪽.
// 정보 행: sub 톤 14/400 라벨과 14/400 값을 같은 줄에 두고, 행은 세로로 쌓는다.
// 일정 화면: 상담 일시와 연락처. 상담 유형과 지난 일정 상태는 헤더 배지.
// 당사자 목록: 참여 사업과 연락처. 케이스 상태는 헤더 배지.
//
// 이름이 없으면 가명 ID가 이름 자리를 대신한다. 없는 선택 정보는 라벨까지 숨긴다.
// 카드 전체가 링크이고 별도 화살표는 두지 않는다.

export interface ParticipantCardSchedule {
  /** "8월 7일 (금)" */
  readonly date: string;
  /** "14:00" */
  readonly time: string;
  /** 상담 종류(인테이크/기본 상담). 블루 계열 뱃지다. */
  readonly kindLabel: string;
  /** 지난 일정 상태(완료/취소/불참). 예정에는 붙이지 않는다. */
  readonly statusLabel?: string | undefined;
}

interface ParticipantCardBaseProps {
  readonly href: string;
  readonly name: string | null;
  readonly beneficiaryId: string;
  readonly phone?: string | null | undefined;
}

interface ParticipantScheduleCardProps extends ParticipantCardBaseProps {
  readonly schedule: ParticipantCardSchedule;
  readonly statusBadge?: never;
  readonly programCount?: never;
  readonly newSignup?: never;
}

interface ParticipantListCardProps extends ParticipantCardBaseProps {
  readonly schedule?: undefined;
  /** 케이스 상태 배지. 당사자 목록이 쓴다. */
  readonly statusBadge: { readonly label: string; readonly tone?: 'mint' | undefined };
  /** 참여 사업 개수. */
  readonly programCount: number;
  /** CCC-26 새 가입 배지. 인테이크 전 케이스로 담당자가 아직 확인하지 않은 당사자. */
  readonly newSignup?: boolean | undefined;
}

export type ParticipantCardProps = ParticipantScheduleCardProps | ParticipantListCardProps;

export function ParticipantCard({
  href,
  schedule,
  name,
  beneficiaryId,
  phone,
  statusBadge,
  programCount,
  newSignup,
}: ParticipantCardProps) {
  const isNameMissing = name === null || name.length === 0;
  const displayName = isNameMissing ? beneficiaryId : name;
  const linkLabel = schedule !== undefined
    ? `${displayName}, ${schedule.date} ${schedule.time} ${schedule.kindLabel}`
    : `${displayName}, 참여 사업 ${programCount}개, ${statusBadge.label}`;

  return (
    <Link aria-label={linkLabel} className="participant-card-link" href={href}>
      <article className="surface-card participant-card">
        <header className="participant-card-header">
          <span className="participant-card-identity">
            {/* 이름 없음은 새 단이 아니라 상태다(§1 is-empty) — 크기·굵기 유지, 색만 물러선다. */}
            <span className={isNameMissing ? 'participant-card-name is-empty' : 'participant-card-name'}>
              {displayName}
            </span>
            {!isNameMissing && <span className="participant-card-id">{beneficiaryId}</span>}
          </span>
          {schedule !== undefined ? (
            <span className="participant-card-badges">
              <WireBadge size="sm" tone="blue">{schedule.kindLabel}</WireBadge>
              {schedule.statusLabel !== undefined && <WireBadge size="sm">{schedule.statusLabel}</WireBadge>}
            </span>
          ) : statusBadge !== undefined ? (
            <span className="participant-card-badges">
              {newSignup === true && <WireBadge size="sm" tone="mint">새 가입</WireBadge>}
              <WireBadge size="sm" {...(statusBadge.tone === undefined ? {} : { tone: statusBadge.tone })}>
                {statusBadge.label}
              </WireBadge>
            </span>
          ) : null}
        </header>

        <div className="participant-card-fields">
          {schedule !== undefined && (
            <WireField compact label="상담 일시" size="sm" tone="sub" truncate>
              <span className="participant-card-date" data-col="date">{schedule.date} {schedule.time}</span>
            </WireField>
          )}
          {schedule === undefined && (
            <WireField compact label="참여 사업" size="sm" tone="sub" truncate>
              <span className="participant-card-emphasis">{programCount}개</span>
            </WireField>
          )}
          {phone !== null && phone !== undefined && phone.length > 0 && (
            <WireField compact label="연락처" size="sm" tone="sub" truncate>{phone}</WireField>
          )}
        </div>
      </article>
    </Link>
  );
}
