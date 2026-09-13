// 정적 셸 워커 등록. 빌드 산출물에서만 돈다(dev 서버에는 `/sw.js` 가 없다).
//
// 워커는 이 빌드가 낸 정적 파일만 캐시한다. 업무 API, 인증, 설치 정보, 부트스트랩, 개인정보,
// 원음은 캐시 대상이 아니다. 새 워커가 와도 강제로 새로고침하지 않고 대기 상태로 남는다.
// 지금 화면의 미저장 입력을 워커 갱신이 지우지 않는다.

/** 새 워커가 대기 중인지. 화면은 이 값을 안내로만 쓰고 스스로 다시 열지 않는다. */
export interface ShellUpdateState {
  waiting: boolean;
}

export function registerShellWorker(
  onUpdate: (state: ShellUpdateState) => void = () => {},
  /** 빌드 산출물에서만 켠다. 테스트가 이 값을 직접 넘긴다. */
  enabled: boolean = import.meta.env.PROD,
): void {
  if (!enabled) return;
  if (!('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .then((registration) => {
      if (registration.waiting !== null) onUpdate({ waiting: true });
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (installing === null) return;
        installing.addEventListener('statechange', () => {
          // 이미 제어 중인 워커가 있는데 새 워커가 설치를 마쳤으면 갱신이 대기 중이다.
          if (installing.state === 'installed' && navigator.serviceWorker.controller !== null) {
            onUpdate({ waiting: true });
          }
        });
      });
    })
    .catch(() => {
      // 워커가 없어도 앱은 그대로 돈다. 실패를 화면에 알리지 않는다.
    });
}
