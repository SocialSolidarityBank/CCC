'use client';

import {
  WireButton,
  WireChoice,
  WireError,
} from '@ccc/wire';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { updateAccountRolesAction } from '../../actions';
import type { AssignableRole, DirectoryAccount } from '../../lib/api';
import { accountRoleLabel } from '../admin-format';

// 사용자·역할 화면의 역할 편집기(D74 역할 합). 서버 계약 PATCH /settings/accounts/:id/roles 는
// { roles, expectedRoles } 만 받는다 — expectedRoles 에 화면이 읽어 둔 현재 역할을 그대로
// 실어 낙관적 동시성 검사를 지킨다(사이에 다른 곳에서 바뀌었으면 서버가 409 로 거절).
// supervisor(실무 책임자)는 팀 감독 부여의 파생 역할이라 이 편집기에서 고르지 못한다 —
// 읽기 배지로만 보여 주고 roles·expectedRoles 양쪽에서 뺀다.
//
// 서버가 강제하는 경계(화면은 안내다): 역할 변경은 기관 관리자만, 자기 기관 관리자 역할은
// 스스로 못 뺀다, 마지막 기관 관리자·기술 관리자는 회수 불가.

const assignableRoleOrder: readonly AssignableRole[] = ['institution-admin', 'technical-admin', 'worker'];

function assignable(roles: DirectoryAccount['roles']): AssignableRole[] {
  return assignableRoleOrder.filter((role) => roles.includes(role));
}

export function UserRolesEditor({
  account,
  canManageRoles,
  isSelf,
}: {
  account: DirectoryAccount;
  canManageRoles: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const expected = assignable(account.roles);
  const [selected, setSelected] = useState<AssignableRole[]>(expected);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // 자기 기관 관리자 역할은 서버가 회수를 거절한다 — 칸을 잠그고 이유를 적는다.
  const selfAdminLocked = isSelf && expected.includes('institution-admin');
  const editable = canManageRoles && account.active;
  const dirty = selected.length !== expected.length || selected.some((role) => !expected.includes(role));

  const toggle = (role: AssignableRole, checked: boolean) => {
    setSelected((current) => (checked ? [...current, role] : current.filter((item) => item !== role)));
    setSaved(false);
    setError(null);
  };

  const save = () => {
    if (pending || !dirty) return;
    setPending(true);
    setError(null);
    setSaved(false);
    const formData = new FormData();
    formData.set('userId', account.id);
    for (const role of selected) formData.append('roles', role);
    for (const role of expected) formData.append('expectedRoles', role);
    void updateAccountRolesAction(formData).then((result) => {
      setPending(false);
      if (result.status === 'updated') {
        setSaved(true);
        router.refresh();
        return;
      }
      if (result.status === 'conflict') {
        // 409 는 동시 변경과 마지막 관리자 회수 둘 다다 — 어느 쪽이든 최신 상태를 다시 읽어야 한다.
        setError('역할이 다른 곳에서 바뀌었거나, 기관에 마지막 남은 관리자 역할은 뺄 수 없습니다. 최신 상태를 확인한 뒤 다시 시도하세요.');
        router.refresh();
        return;
      }
      if (result.status === 'access_denied' || result.status === 'forbidden') {
        setError('역할 변경은 기관 관리자만 할 수 있습니다.');
        return;
      }
      setError('역할을 저장하지 못했습니다. 잠시 후 다시 시도하세요.');
    });
  };

  return (
    <div className="wire-admin-list">
      {editable ? (
        assignableRoleOrder.map((role) => (
          <WireChoice
            key={role}
            type="checkbox"
            label={accountRoleLabel[role]}
            checked={selected.includes(role)}
            disabled={pending || (role === 'institution-admin' && selfAdminLocked)}
            onChange={(checked) => toggle(role, checked)}
            desc={
              role === 'worker'
                ? '실무자 역할이 없으면 상담 기록을 쓸 수 없습니다.'
                : role === 'institution-admin' && selfAdminLocked
                  ? '자기 기관 관리자 역할은 스스로 뺄 수 없습니다.'
                  : undefined
            }
          />
        ))
      ) : (
        <p className="wire-form-hint">
          {canManageRoles
            ? '비활성 계정의 역할은 바꿀 수 없습니다.'
            : '역할 변경은 기관 관리자만 할 수 있습니다.'}
        </p>
      )}
      {account.roles.includes('supervisor') ? (
        <p className="wire-form-hint">실무 책임자는 팀 감독 부여로 생기는 역할이라 여기서 바꾸지 않습니다.</p>
      ) : null}
      {editable ? (
        <div>
          <WireButton variant="primary" disabled={pending || !dirty} onClick={save}>
            {pending ? '저장 중' : '역할 저장'}
          </WireButton>
        </div>
      ) : null}
      {error !== null ? <WireError>{error}</WireError> : null}
      {saved ? (
        <p className="wire-form-hint" role="status">역할을 저장했습니다.</p>
      ) : null}
    </div>
  );
}
