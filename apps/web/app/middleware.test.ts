import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

import { middleware } from '../middleware';

/**
 * 미들웨어가 `x-ccc-public` 을 **저작**하는지 고정한다.
 *
 * 이 헤더는 루트 레이아웃이 "셸(사이드바)을 뺄 공개 화면인가"를 판별하는 근거다.
 * 공개 경로에서만 세우고 나머지에서 손대지 않으면, 클라이언트가 헤더를 붙여 보낸 것이
 * 그대로 서버 컴포넌트까지 도달한다. 지금 눈에 보이는 영향은 셸이 빠지는 정도지만
 * 헤더의 의미가 "이 요청은 미인증 공개 요청"이라, 여기에 판단을 하나 더 걸면 그 순간
 * 인증 우회가 된다. 그래서 값의 출처를 테스트로 고정한다.
 */

function makeRequest(pathname: string, headers: Record<string, string> = {}): NextRequest {
  const url = new URL(`https://example.test${pathname}`);
  return {
    nextUrl: Object.assign(url, { clone: () => new URL(url.toString()) }),
    headers: new Headers(headers),
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

/**
 * 서버 컴포넌트가 실제로 보게 되는 헤더 값을 계산한다.
 *
 * `x-middleware-request-*` 만 읽으면 안 된다 — 미들웨어가 헤더를 덮어쓰지 않고 그냥
 * `NextResponse.next()` 로 통과시키면 그 헤더는 아예 생기지 않고, **원본 요청 헤더가
 * 그대로 다운스트림에 도달한다.** 그래서 "override 가 없으면 원본" 을 함께 모델링하지
 * 않으면 취약한 구현에서도 테스트가 통과해 버린다(실제로 그렇게 헛돌던 것을 잡았다).
 *
 * Next 는 덮어쓴 경우 `x-middleware-override-headers` 에 **최종 헤더 이름 전체**를 싣고
 * 다운스트림 요청 헤더를 그 목록으로 재구성한다 — 즉 목록에 없으면 그 헤더는 사라진다.
 */
function effectiveHeader(response: Response, request: NextRequest, name: string): string | null {
  const overrides = response.headers.get('x-middleware-override-headers');
  if (overrides === null) return request.headers.get(name); // 덮어쓰지 않음 → 원본 통과
  const names = overrides.split(',').map((entry) => entry.trim().toLowerCase());
  if (!names.includes(name)) return null; // 재구성 목록에 없음 → 제거됨
  return response.headers.get(`x-middleware-request-${name}`);
}

describe('middleware · x-ccc-public 저작', () => {
  beforeEach(() => {
    vi.stubEnv('CCC_PREVIEW', 'false');
  });

  it('공개 가입 경로에는 미들웨어가 헤더를 세운다', () => {
    for (const path of ['/join', '/join/participant/abc']) {
      const request = makeRequest(path);
      expect(effectiveHeader(middleware(request), request, 'x-ccc-public')).toBe('1');
    }
  });

  it('비공개 경로에서 클라이언트가 보낸 헤더는 지워진다', () => {
    const request = makeRequest('/participants/crane-001/briefing', { 'x-ccc-public': '1' });
    expect(effectiveHeader(middleware(request), request, 'x-ccc-public')).toBeNull();
  });

  it("'/join' 접두만 흉내 낸 경로는 공개가 아니다", () => {
    // startsWith('/join') 로 매칭하면 여기가 공개로 뚫린다.
    const request = makeRequest('/joinx', { 'x-ccc-public': '1' });
    expect(effectiveHeader(middleware(request), request, 'x-ccc-public')).toBeNull();
  });

  it('미리보기에서는 공개 가입 경로도 코드 게이트로 유도된다', () => {
    // 2026-07-28 Q 결정(ADR-0016 개정): 미리보기에는 공개 표면을 두지 않는다.
    // 이 분기가 없으면 미리보기 링크에 /join 경로만 코드 없이 뚫린다.
    vi.stubEnv('CCC_PREVIEW', 'true');
    const response = middleware(makeRequest('/join/participant/abc'));
    expect(response.headers.get('location')).toContain('/preview');
  });

  it('운영·로컬에서는 공개 가입 경로가 그대로 열린다', () => {
    // 미리보기 잠금이 운영 흐름까지 잠그면 당사자가 가입할 수 없다(당사자는 users 미등재).
    const request = makeRequest('/join/participant/abc');
    const response = middleware(request);
    expect(response.headers.get('location')).toBeNull();
    expect(effectiveHeader(response, request, 'x-ccc-public')).toBe('1');
  });

  it('미리보기 게이트 분기에서도 클라이언트 헤더가 통과하지 않는다', () => {
    vi.stubEnv('CCC_PREVIEW', 'true');
    // 쿠키가 없으므로 /preview 로 리다이렉트된다 — 통과 응답이 아니어야 한다.
    const redirected = middleware(makeRequest('/participants/crane-001', { 'x-ccc-public': '1' }));
    expect(redirected.headers.get('location')).toContain('/preview');
    // /preview 자체는 통과하되 헤더는 지워진 채로 간다.
    const request = makeRequest('/preview', { 'x-ccc-public': '1' });
    expect(effectiveHeader(middleware(request), request, 'x-ccc-public')).toBeNull();
  });
});
