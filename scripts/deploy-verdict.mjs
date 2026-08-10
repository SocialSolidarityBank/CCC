/**
 * 운영 배포 실행의 **이 시점 판정** (2026-08-10 신설).
 *
 * 왜 파일을 따로 뺐나. 이 판정이 한 번 거짓 성공을 냈고(아래), 고친 뒤에도 그것을 확인할
 * 길이 없으면 같은 일이 반복된다. deploy-production.mjs 는 불러오는 순간 사전 점검을
 * 돌리므로 테스트가 import 할 수 없다 — 판정만 떼어 두면 실제 API 응답 모양으로 잰다.
 *
 * `red` **무엇이 잘못됐었나** (2026-08-10 실측). 예전 판정은 실행의 `status === 'completed'`
 * 를 성공으로 읽었다. 그런데 마지막 검증 잡(schema-gate)이 끝나고 승인 게이트가 등록되기까지의
 * 찰나에 GitHub API 가 실행을 `completed` 로 보고한다(`updated_at` 이 schema-gate 종료 시각과
 * 같았다). 그 순간을 잡아 "배포 성공"을 출력하고 끝냈고, 실제로는 승인 대기였으며 배포 잡은
 * 시작조차 하지 않았다.
 *
 * 실패보다 나쁘다. 실패는 다시 돌리면 되지만 거짓 성공은 **안 나간 것을 나갔다고 믿게** 만든다.
 *
 * 그래서 배포 여부는 배포 잡 하나만 본다. 실행 상태는 그 대리 지표였고, 대리 지표가 틀렸다.
 */

export const DEPLOY_JOB = 'deploy-production';

/**
 * @param {{status?: string, conclusion?: string|null, jobs?: {name: string, status?: string, conclusion?: string|null}[]}} state
 *   `gh run view <id> --json status,conclusion,jobs` 의 결과.
 * @returns {{done: boolean, error?: string, waiting?: boolean}}
 */
export function verdict(state) {
  const job = state.jobs?.find((candidate) => candidate.name.includes(DEPLOY_JOB));
  if (job?.conclusion === 'success') return { done: true };
  if (job?.conclusion) return { done: true, error: `배포 잡이 ${job.conclusion} 로 끝났다` };
  // 배포 잡이 아직 결론이 없는데 실행이 끝났다면 취소·건너뜀이다. 성공으로 읽지 않는다.
  if (state.status === 'completed') {
    return { done: true, error: `실행이 ${state.conclusion ?? '결론 없이'} 끝났는데 배포 잡은 돌지 않았다` };
  }
  return { done: false, waiting: job?.status === 'waiting' || state.status === 'waiting' };
}
