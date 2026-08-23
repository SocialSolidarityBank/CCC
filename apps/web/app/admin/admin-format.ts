import type { AdminAssignmentParticipant } from '../lib/api';

// 사업 표시 라벨은 CCC-32 부터 정적 상수가 아니다 — 각 페이지가 getDisplayLabels()
// (온보딩 저장값 우선, labels.ts 폴백)로 요청 시점에 읽는다.

export const assignmentStatusLabel: Record<AdminAssignmentParticipant['status'], string> = {
  active: '진행 중',
  closed: '종결',
};


// 관리자 메뉴 정의 — 탭(AdminSidebar)과 설정 화면 진입구(AdminSection)가 공유한다.
// 'use client' 모듈에 두면 서버 컴포넌트가 실제 배열 대신 클라이언트 참조 프록시를 받는다.
//
// '설정' 항목은 없다(CCC-55, 2026-08-08 Q 승인). 설정은 관리자 영역이 아니라 셸 헤더·사이드바의
// 톱니바퀴 버튼이 갖는 자리이고, 그 버튼은 관리자 화면을 포함해 어디서든 보인다. 여기 탭으로
// 두면 누르는 순간 관리자 레이아웃 밖으로 나가 탭줄이 사라지는데, 이 목록은 '관리자 영역 안의
// 장소'를 나열하는 곳이다.
//
// 구 '/admin/settings' 는 설정 화면을 관리자 레이아웃 안에 통째로 다시 그리는 재수출이었다.
// main 이 main 안에 들어갔고, 관리자 탭과 설정 화면 속 관리자 링크가 함께 떠 순환했다.
export interface AdminMenuItem {
  label: string;
  href: string;
}
export const adminMenu: AdminMenuItem[] = [
  { label: '기관', href: '/admin' },
  { label: '배정', href: '/admin/assign' },
  { label: '사용자', href: '/admin/users' },
  { label: '실무자 초대', href: '/admin/invite' },
  { label: 'AI 사업자', href: '/admin/ai-provider' },
];

/**
 * 직원(실무자·관리자) 표시 라벨(D31): 이름이 있으면 이름, 없으면 이메일로 폴백한다.
 * 목록·배정 등 한 줄 표기에 쓴다. 이메일은 보조 정보로 별도 표기한다.
 */
export function userLabel(user: { name: string | null; email: string }): string {
  return user.name ?? user.email;
}

/**
 * 관리자 당사자 행 요약 조각: 실명, 연락처. 실명 미기입이면 슬러그 폴백(D31 —
 * 슬러그는 기계 식별자라 실명이 있으면 화면에 병기하지 않는다). 사업명은 목록에서
 * 제외 — 단일 사업 반복 표기는 소음이고, 확인은 상세 화면 몫이다.
 */
export function assignmentSummaryItems(participant: AdminAssignmentParticipant): string[] {
  // 조각 배열로 주는 이유: 구분자 가운뎃점을 문자열에 박지 않고 MetaRow 간격이 나눈다(§10, 2026-08-07).
  return [
    participant.participantName ?? participant.beneficiaryId,
    participant.participantPhone ?? '연락처 미기입',
  ];
}
