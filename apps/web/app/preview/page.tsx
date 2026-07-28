import type { Metadata } from 'next';
import { unlockPreviewAction } from '../actions';
import { WireButton } from '../components/wire/wire-button';
import { WireFormField } from '../components/wire/wire-form-field';

export const metadata: Metadata = { title: 'CCC 사례관리 미리보기' };

const errorMessages: Record<string, string> = {
  invalid_request: '코드가 올바르지 않습니다. 다시 확인하세요.',
  authentication_required: '코드가 올바르지 않습니다. 다시 확인하세요.',
  service_unavailable: '지금 확인할 수 없습니다. 잠시 후 다시 시도하세요.',
};

type SearchParams = Record<string, string | string[] | undefined>;

function queryValue(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * 미리보기 코드 게이트 진입 화면(CCC-6). 팀원이 지정 코드를 입력하면 unlockPreviewAction 이
 * API 로 검증하고 세션 쿠키를 심은 뒤 홈으로 보낸다. 이 화면은 API 를 호출하지 않아 쿠키
 * 없이도 렌더된다. 쿠키가 없는 다른 경로는 middleware.ts 가 이 화면으로 되돌린다.
 */
export default async function PreviewGatePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const errorCode = queryValue(query, 'error');

  return (
    <div className="page-content narrow">
      <div className="page-header">
        <div>
          <h1>미리보기 접속</h1>
          <p>개발 중인 서비스를 미리 보려면 전달받은 코드를 입력하세요.</p>
        </div>
      </div>

      {errorCode !== undefined ? (
        <p role="alert" className="wire-field-error">{errorMessages[errorCode] ?? '확인하지 못했습니다.'}</p>
      ) : null}

      <form className="schedule-form" action={unlockPreviewAction}>
        <WireFormField label="접속 코드" required htmlFor="preview-code">
          <input id="preview-code" type="password" name="code" autoComplete="off" autoFocus required />
        </WireFormField>
        <div className="wire-form-actions">
          <WireButton type="submit" variant="primary">입장</WireButton>
        </div>
        {/* 화면 전체에 대한 안내라 입력칸의 도움말(hint)이 아니라 폼 아래 한 줄로 둔다. */}
        <p className="note-inline">
          이 미리보기는 가상 시드 데이터만 담고 있으며 실제 참여자 정보와 연결되어 있지 않습니다.
        </p>
      </form>
    </div>
  );
}
