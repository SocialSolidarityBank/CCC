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
    // 공개 가입 스위치(CCC-112)가 켜진 배포를 기준으로 헤더 저작을 검증한다.
    // 꺼짐(기본) 동작은 아래 '공개 가입 스위치' describe 가 별도로 고정한다.
    vi.stubEnv('PUBLIC_SIGNUP_ENABLED', '1');
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
    // 클라이언트가 보낸 헤더가 그대로 흘러가지 않는다는 성질은 위 리다이렉트와
    // '비공개 경로에서 클라이언트가 보낸 헤더는 지워진다' 테스트가 지킨다.
  });

  it('공개 입구 화면(/welcome)은 인증 없이 열리고 셸이 빠진다', () => {
    // CCC-109: 소개·로그인 입구라 신원을 아직 모르는 화면이다. 헤더가 세워져야 루트
    // 레이아웃이 사이드바를 빼고, 리다이렉트가 없어야 운영·로컬에서 인증 없이 렌더된다.
    // 가입 쓰기 경로가 아니므로 가입 스위치(CCC-112)가 생겨도 이 성질은 유지되어야 한다.
    const request = makeRequest('/welcome');
    const response = middleware(request);
    expect(response.headers.get('location')).toBeNull();
    expect(effectiveHeader(response, request, 'x-ccc-public')).toBe('1');
  });

  it("'/welcome' 접두만 흉내 낸 경로는 공개가 아니다", () => {
    const request = makeRequest('/welcomex', { 'x-ccc-public': '1' });
    expect(effectiveHeader(middleware(request), request, 'x-ccc-public')).toBeNull();
  });

  it('코드 입력 화면은 셸 없이 렌더된다', () => {
    // 2026-07-31: /preview 를 공개(셸 제외) 목록에 넣었다. 안 그러면 로그아웃한 화면에
    // 사이드바가 그대로 남아 "나갔는데 안 나간 것"처럼 보인다.
    // 값이 '1' 인 것은 **미들웨어가 세웠기 때문**이지 클라이언트가 보내서가 아니다 —
    // 미들웨어는 모든 경로에서 이 헤더를 다시 저작하므로 위조분은 언제나 덮인다.
    vi.stubEnv('CCC_PREVIEW', 'true');
    const request = makeRequest('/preview');
    expect(effectiveHeader(middleware(request), request, 'x-ccc-public')).toBe('1');
  });
});

/**
 * 공개 가입 스위치(CCC-112 · P0-2): CCC_PREVIEW 가 아닌 환경에서 PUBLIC_SIGNUP_ENABLED 가
 * 정확히 '1' 이 아니면 /join·/join/* 는 404 다. 기본(미설정)이 닫힘 — 운영 wrangler vars 에
 * 변수를 두지 않는 것만으로 표면이 닫힌다(API 게이트와 같은 fail closed 규약).
 */
describe('middleware · 공개 가입 스위치(CCC-112)', () => {
  beforeEach(() => {
    vi.stubEnv('CCC_PREVIEW', 'false');
    vi.stubEnv('PUBLIC_SIGNUP_ENABLED', undefined);
  });

  it('스위치 미설정이면 운영·로컬에서 /join·/join/* 는 404', () => {
    for (const path of ['/join', '/join/participant/abc']) {
      const response = middleware(makeRequest(path));
      expect(response.status).toBe(404);
    }
  });

  it("정확히 '1' 만 연다 — '0'·'true' 는 닫힘", () => {
    for (const value of ['0', 'true']) {
      vi.stubEnv('PUBLIC_SIGNUP_ENABLED', value);
      expect(middleware(makeRequest('/join')).status).toBe(404);
    }
    vi.stubEnv('PUBLIC_SIGNUP_ENABLED', '1');
    const request = makeRequest('/join/participant/abc');
    const response = middleware(request);
    expect(response.status).not.toBe(404);
    expect(effectiveHeader(response, request, 'x-ccc-public')).toBe('1');
  });

  it('스위치가 꺼져도 /join 이 아닌 공개 화면(/preview 등)은 영향이 없다', () => {
    // /welcome(CCC-109) 같은 다른 공개 화면도 마찬가지로 스위치와 무관하다 —
    // 404 분기는 /join 정확 일치 + '/join/' 접두에만 적용된다.
    expect(middleware(makeRequest('/preview')).status).not.toBe(404);
    expect(middleware(makeRequest('/joinx')).status).not.toBe(404);
  });

  it('미리보기에서는 스위치가 꺼져 있어도 404 가 아니라 코드 게이트로 유도된다', () => {
    // 미리보기 잠금(코드 세션)이 앞이고, 미리보기 배포는 wrangler vars 로 스위치를 켠다.
    vi.stubEnv('CCC_PREVIEW', 'true');
    const response = middleware(makeRequest('/join/participant/abc'));
    expect(response.status).not.toBe(404);
    expect(response.headers.get('location')).toContain('/preview');
  });
});
