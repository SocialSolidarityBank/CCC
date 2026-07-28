'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { SearchInput } from '../components/wire/search-input';

// 당사자 목록 좁히기 (D21 '상단 당사자 검색'의 새 자리 — 상단 헤더 폐기로 옮겨왔다).
//
// **서버 검색이 아니라 이미 받은 목록을 좁힌다.** 담당 당사자는 수십 명 규모라 왕복을
// 더할 이유가 없고, 한 글자마다 서버를 때리지 않으며, 오타를 지우면 목록이 그대로
// 돌아온다. 서버 검색(`searchParticipants`)은 상담 등록처럼 담당 밖까지 찾아야 하는
// 자리의 것이다.
//
// 행 렌더는 서버 컴포넌트가 만들어 넘긴다 — PII 복호화·감사가 서버에 있어야 하므로
// 여기로 데이터를 들이지 않고 완성된 노드만 받는다.

export interface ParticipantFilterRow {
  beneficiaryId: string;
  /** 소문자로 정규화된 대조용 문자열(이름·가명 ID·연락처). */
  haystack: string;
  node: ReactNode;
}

export function ParticipantFilter({ rows }: { rows: ParticipantFilterRow[] }) {
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return rows;
    return rows.filter((row) => row.haystack.includes(needle));
  }, [query, rows]);

  return (
    <div className="participant-search-layout">
      <SearchInput
        label="당사자 찾기"
        name="participantQuery"
        placeholder="이름, 가명 ID, 연락처"
        value={query}
        onChange={setQuery}
      />
      {visible.length === 0 ? (
        <p className="empty" role="status" aria-live="polite">
          찾는 당사자가 없습니다. 이름 일부만 입력해 보세요.
        </p>
      ) : (
        <div className="participant-row-list">
          {visible.map((row) => <div key={row.beneficiaryId}>{row.node}</div>)}
        </div>
      )}
    </div>
  );
}
