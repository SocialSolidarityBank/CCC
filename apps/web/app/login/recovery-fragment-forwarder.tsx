'use client';

import { useEffect } from 'react';

/**
 * Supabase recovery·초대 링크의 착지 안전장치.
 *
 * 메일 링크의 redirect_to 가 allow-list 에 없으면 Supabase 는 site_url(루트)로 보내고,
 * 세션 게이트가 그 요청을 /login 으로 돌린다 — fragment 는 리다이렉트를 따라 살아 있다.
 * 그 경우 자격(#access_token=…&type=recovery)을 든 사람이 로그인 화면에 멈추므로,
 * fragment 를 단 채 /password 로 넘긴다. fragment 는 서버에 안 가니 여기서만 볼 수 있다.
 */
export function RecoveryFragmentForwarder() {
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('access_token=') || hash.includes('error_code=')) {
      window.location.replace(`/password${hash}`);
    }
  }, []);
  return null;
}
