import { notFound } from 'next/navigation';
import { WireCard } from '../../../components/wire/wire-card';
import { WireBadge } from '../../../components/wire/wire-badge';
import { formatKoreanDateTime } from '../../../lib/format-korean-date';
import { PROGRAM_LABELS } from '../../../lib/labels';
import { getParticipantSelfCheck, getPublicInviteInfo, type ParticipantSelfCheck } from '../../../lib/api';
import { SignupForm } from './signup-form';

const scheduleStatusLabels: Record<ParticipantSelfCheck['upcomingSchedules'][number]['status'], string> = {
  scheduled: '예정',
  completed: '완료',
  cancelled: '취소',
  no_show: '불참',
};

function scheduleStatusLabel(status: ParticipantSelfCheck['upcomingSchedules'][number]['status']): string {
  const label = scheduleStatusLabels[status];
  if (label === undefined) throw new Error('Self-check schedule status was invalid.');
  return label;
}

// CCC-27 자기 확인 — 가입 링크(같은 토큰)로 여는 본인 정보. 보이는 것은 정확히
// 다섯 갈래: 이름·연락처 / 참여 사업+담당 실무자 / 다가오는·지난 일정 / 동의 상태.
// 기록 내용(요약·플래그·브리핑)은 서버 응답에 없다(API 계약, 테스트로 고정).
function SelfCheckView({ data }: { data: ParticipantSelfCheck }) {
  return <main className="page-content">
    <WireCard>
      <h1>당사자 자기 확인</h1>
      <p className="wire-invite-caption">이 링크로 참여 중인 사업과 상담 일정, 동의 상태를 확인할 수 있습니다.</p>

      <section className="self-check-block" aria-labelledby="self-check-contact">
        <h2 id="self-check-contact">내 정보</h2>
        <p className="self-check-row">이름{' '}<strong>{data.name ?? '기재 안 함'}</strong></p>
        <p className="self-check-row">연락처{' '}<strong>{data.phone ?? '기재 안 함'}</strong></p>
        <p className="self-check-row">이메일{' '}<strong>{data.email ?? '기재 안 함'}</strong></p>
      </section>

      <section className="self-check-block" aria-labelledby="self-check-programs">
        <h2 id="self-check-programs">참여 중인 사업</h2>
        {data.programs.length === 0
          ? <p className="panel-meta">참여 중인 사업이 없습니다.</p>
          : data.programs.map((program, index) => {
            const label = PROGRAM_LABELS[program.programType as keyof typeof PROGRAM_LABELS] ?? program.programType;
            return <p className="self-check-row" key={`${program.programType}-${index}`}>
              <strong>{label}</strong>
              <WireBadge tone="mint">담당 {program.counselorName ?? '미배정'}</WireBadge>
              <WireBadge {...(program.consent.privacy ? { tone: 'mint' } : {})}>
                개인정보 동의 {program.consent.privacy ? '완료' : '미완료'}
              </WireBadge>
              <WireBadge {...(program.consent.recordingAi ? { tone: 'mint' } : {})}>
                AI 녹취 동의 {program.consent.recordingAi ? '완료' : '미완료'}
              </WireBadge>
            </p>;
          })}
      </section>

      <section className="self-check-block" aria-labelledby="self-check-schedules">
        <h2 id="self-check-schedules">상담 일정</h2>
        {data.upcomingSchedules.length === 0 && data.pastSchedules.length === 0
          ? <p className="panel-meta">등록된 상담 일정이 없습니다.</p>
          : <>
              {data.upcomingSchedules.map((schedule) => (
                <p className="self-check-row" key={schedule.id}>
                  <strong>{formatKoreanDateTime(schedule.scheduledAt)}</strong>
                  <WireBadge tone="blue">예정</WireBadge>
                </p>
              ))}
              {data.pastSchedules.map((schedule) => (
                <p className="self-check-row" key={schedule.id}>
                  <span>{formatKoreanDateTime(schedule.scheduledAt)}</span>
                  <WireBadge>{scheduleStatusLabel(schedule.status)}</WireBadge>
                </p>
              ))}
            </>}
      </section>
    </WireCard>
  </main>;
}

// 공개 당사자 가입 화면(CCC-28 · D39 · ADR-0016 #4). 토큰이 유효하면 폼을,
// 이미 가입해 소비된 토큰이면 같은 링크로 자기 확인(CCC-27)을 연다.
// 무효·타인 토큰은 "사용할 수 없는 링크" 안내. 인증 불필요 —
// middleware.ts 가 /join 경로를 게이트에서 제외한다.
export default async function JoinParticipantPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  try {
    const info = await getPublicInviteInfo(token);
    const programLabel = PROGRAM_LABELS[info.programType as keyof typeof PROGRAM_LABELS] ?? info.programType;

    return (
      <main className="page-content">
        <WireCard>
          <h1>당사자 가입</h1>
          <p className="wire-invite-caption">
            {programLabel} 사업에 참여하기 위해 아래 정보를 입력해 주세요.
          </p>
          <SignupForm token={token} />
        </WireCard>
      </main>
    );
  } catch {
    // 가입 전 토큰이 아니면 자기 확인을 시도한다 — 가입이 끝난 링크 재방문이 CCC-27 의
    // 도착지다(2026-07 부터 이 분기가 "사용할 수 없는 링크"만 내던 자리).
    try {
      const selfCheck = await getParticipantSelfCheck(token);
      return <SelfCheckView data={selfCheck} />;
    } catch {
      notFound();
    }
  }
}
