import { NextRequest, NextResponse } from 'next/server';
import { ApiError, requestPreviewUnlock } from '../../lib/api';
import { PREVIEW_COOKIE_NAME } from '../../lib/preview-cookie';

type PreviewMode = 'counselor' | 'admin';

function modeFrom(value: FormDataEntryValue | null): PreviewMode {
  return value === 'admin' ? 'admin' : 'counselor';
}

function gatePath(mode: PreviewMode): string {
  return mode === 'admin' ? '/preview/admin' : '/preview';
}

function successPath(mode: PreviewMode): string {
  return mode === 'admin' ? '/settings' : '/';
}

function errorCode(error: unknown): string {
  if (!(error instanceof ApiError)) throw error;
  return error.code === 'service_unavailable' ? 'service_unavailable' : 'invalid_request';
}

function errorRedirect(request: NextRequest, mode: PreviewMode, code: string): NextResponse {
  const destination = new URL(gatePath(mode), request.url);
  destination.searchParams.set('error', code);
  return NextResponse.redirect(destination, 303);
}

/**
 * 일반 HTML POST 수신점. 성공 응답을 303 으로 보내 브라우저가 새 문서를 요청하게 한다.
 * 서버 액션 redirect 는 프로덕션에서 /preview 의 셸 없는 루트 레이아웃을 재사용해,
 * 로그인 직후 헤더·사이드바가 사라지고 새로고침해야 나타나는 결함을 만들었다.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const form = await request.formData();
  const mode = modeFrom(form.get('mode'));
  const codeValue = form.get('code');
  const code = typeof codeValue === 'string' ? codeValue.trim() : '';

  if (code.length === 0) return errorRedirect(request, mode, 'invalid_request');

  let result: Awaited<ReturnType<typeof requestPreviewUnlock>>;
  try {
    result = await requestPreviewUnlock(code);
  } catch (error) {
    return errorRedirect(request, mode, errorCode(error));
  }

  const response = NextResponse.redirect(new URL(successPath(mode), request.url), 303);
  response.cookies.set(PREVIEW_COOKIE_NAME, result.token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: result.maxAgeSeconds,
  });
  return response;
}
