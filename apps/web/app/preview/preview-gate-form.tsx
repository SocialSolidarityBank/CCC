import { WireButton } from '../components/wire/wire-button';
import { WireFormField } from '../components/wire/wire-form-field';

const errorMessages: Record<string, string> = {
  invalid_request: '코드가 올바르지 않습니다. 다시 확인하세요.',
  authentication_required: '코드가 올바르지 않습니다. 다시 확인하세요.',
  service_unavailable: '지금 확인할 수 없습니다. 잠시 후 다시 시도하세요.',
};
/* 빌드 도장(2026-09-04). 프리뷰가 어느 커밋을 서빙하는지 로그인 없이도 한눈에 읽는다.
   main 자동 배포가 수동 배포를 덮어써 "반영이 안 됐다"로 읽힌 사고가 계기다.
   NEXT_PUBLIC_ 접두사라 빌드 시점에 박힌다 — Workers 런타임 env 가 아니라 빌드한 쪽의
   git 상태가 그대로 남는다. 워크플로와 scripts/deploy-preview.mjs 가 같은 형식으로 채운다. */
const BUILD_STAMP = process.env.NEXT_PUBLIC_CCC_BUILD_STAMP;

interface PreviewGateFormProps {
  mode: 'counselor' | 'admin';
  errorCode: string | undefined;
}

export function PreviewGateForm({ mode, errorCode }: PreviewGateFormProps) {
  const admin = mode === 'admin';

  return (
    /* 게이트 문법(2026-08-09 Q "컴포넌트 가운데 정렬로 전면 수정") — 셸 없는 공개 화면이라
       화면 세로·가로 중앙에 제목·설명·카드가 한 축으로 선다. */
    <main className="page-content preview-gate">
      <div className="preview-gate-head">
        <h1>{admin ? '기관 관리자 미리보기 접속' : '미리보기 접속'}</h1>
        <p>
          {admin
            ? '기관 관리자 화면을 확인하려면 관리자용 코드를 입력하세요.'
            : '개발 중인 서비스를 미리 보려면 전달받은 코드를 입력하세요.'}
        </p>
      </div>

      {errorCode !== undefined ? (
        <p role="alert" className="wire-field-error">
          {errorMessages[errorCode] ?? '확인하지 못했습니다.'}
        </p>
      ) : null}

      {/* 서버 액션을 쓰지 않는다. 일반 POST + 303 응답으로 브라우저가 새 문서를 받아야
          /preview 의 셸 없는 루트 레이아웃이 로그인 뒤 화면에 남지 않는다(2026-08-22 실측). */}
      <form className="surface-card preview-gate-card" method="post" action="/preview/unlock">
        <input type="hidden" name="mode" value={mode} />
        <WireFormField label="접속 코드" required htmlFor="preview-code">
          <input id="preview-code" type="password" name="code" autoComplete="off" autoFocus required />
        </WireFormField>
        <WireButton type="submit" variant="primary" className="preview-gate-submit">
          {admin ? '기관 관리자로 입장' : '실무자로 입장'}
        </WireButton>
        <WireButton
          variant="secondary"
          href={admin ? '/preview' : '/preview/admin'}
          className="preview-gate-submit"
        >
          {admin ? '실무자 미리보기' : '기관 관리자 미리보기'}
        </WireButton>
        <p className="note-inline">
          이 미리보기는 가상 시드 데이터만 담고 있으며 실제 당사자 정보와 연결되어 있지 않습니다.
        </p>
        {BUILD_STAMP === undefined || BUILD_STAMP.length === 0 ? null : (
          <p className="note-inline" data-testid="preview-build-stamp">빌드 {BUILD_STAMP}</p>
        )}
      </form>
    </main>
  );
}
