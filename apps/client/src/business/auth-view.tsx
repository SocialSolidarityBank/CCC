import { useState } from 'react';
import { WireButton, WireCard, WireChoice, WireEmpty, WireError, WireFormField } from '@ccc/web/wire';
import type { AuthSnapshot, CloudAuth, TotpEnrollment } from './auth';

function EnrollmentSecret({ enrollment }: { enrollment: TotpEnrollment }) {
  const [visible, setVisible] = useState(false);
  return <>
    <img className="business-qr" src={enrollment.qrCode} width={240} height={240} alt="인증 앱 등록용 QR 코드" />
    <WireFormField label="QR 코드를 읽을 수 없을 때 직접 입력할 등록 키" htmlFor="totp-secret">
      <input id="totp-secret" type={visible ? 'text' : 'password'} value={enrollment.secret} readOnly autoComplete="off" spellCheck={false} />
    </WireFormField>
    <WireChoice type="checkbox" label="등록 키 보기" checked={visible} onChange={setVisible} />
  </>;
}

export function AuthView({ auth, snapshot }: { auth: CloudAuth; snapshot: AuthSnapshot }) {
  const [factor, setFactor] = useState(snapshot.factors[0]?.id ?? '');
  const selectedFactor = snapshot.enrollment?.id ?? (snapshot.factors.some((candidate) => candidate.id === factor)
    ? factor : snapshot.factors[0]?.id ?? '');
  const passwordStep = snapshot.phase === 'signed-out' || snapshot.phase === 'signing-in';
  return <WireCard as="section" labelledBy="auth-title" title={<h2 id="auth-title">{passwordStep ? '기관 계정 로그인' : '추가 인증'}</h2>}>
    {snapshot.error && <WireError>{snapshot.error.message}</WireError>}
    {passwordStep && <form className="business-form" onSubmit={(event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const email = values.get('email');
      const password = values.get('password');
      event.currentTarget.reset();
      if (typeof email === 'string' && typeof password === 'string') void auth.signIn(email.trim(), password);
    }}>
      <WireFormField label="이메일" htmlFor="login-email" required>
        <input id="login-email" name="email" type="email" autoComplete="username" required disabled={snapshot.working} />
      </WireFormField>
      <WireFormField label="비밀번호" htmlFor="login-password" required>
        <input id="login-password" name="password" type="password" autoComplete="current-password" required disabled={snapshot.working} />
      </WireFormField>
      <WireButton type="submit" variant="primary" disabled={snapshot.working}>로그인</WireButton>
    </form>}
    {snapshot.phase === 'checking' && <WireEmpty live>로그인과 추가 인증 상태를 확인하고 있습니다.</WireEmpty>}
    {snapshot.phase === 'signing-out' && <WireEmpty live>업무 자료를 비우고 서버의 로그인을 종료하고 있습니다.</WireEmpty>}
    {snapshot.phase === 'mfa' && <>
      {snapshot.factors.length > 0 && <WireFormField label="인증 앱" htmlFor="totp-factor" control="select">
        <select id="totp-factor" value={selectedFactor} disabled={snapshot.working} onChange={(event) => setFactor(event.target.value)}>
          {snapshot.factors.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
        </select>
      </WireFormField>}
      {snapshot.factors.length === 0 && snapshot.enrollment === null && <>
        <WireEmpty>등록된 인증 앱이 없습니다. 먼저 인증 앱을 등록해 주세요.</WireEmpty>
        <WireButton variant="primary" disabled={snapshot.working} onClick={() => { void auth.enroll(); }}>인증 앱 등록</WireButton>
      </>}
      {snapshot.enrollment && <>
        <EnrollmentSecret key={snapshot.enrollment.id} enrollment={snapshot.enrollment} />
        <WireButton variant="neutral" disabled={snapshot.working} onClick={() => { void auth.cancelEnrollment(); }}>등록 취소</WireButton>
      </>}
      {selectedFactor && <form className="business-form" onSubmit={(event) => {
        event.preventDefault();
        const code = new FormData(event.currentTarget).get('code');
        event.currentTarget.reset();
        if (typeof code === 'string') void auth.verify(selectedFactor, code.trim());
      }}>
        <WireFormField label="인증 앱의 여섯 자리 번호" htmlFor="totp-code" required>
          <input id="totp-code" name="code" inputMode="numeric" autoComplete="one-time-code"
            pattern="[0-9]{6}" minLength={6} maxLength={6} required disabled={snapshot.working} />
        </WireFormField>
        <WireButton type="submit" variant="primary" disabled={snapshot.working}>인증 완료</WireButton>
      </form>}
    </>}
    {snapshot.phase === 'error' && <WireButton variant="neutral" onClick={() => auth.recheck()}>인증 상태 다시 확인</WireButton>}
    {!passwordStep && snapshot.phase !== 'signing-out' && <WireButton variant="neutral" disabled={snapshot.working}
      onClick={() => { void auth.signOut(); }}>로그아웃</WireButton>}
  </WireCard>;
}
