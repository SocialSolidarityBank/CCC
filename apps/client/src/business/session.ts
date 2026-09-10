import type { CapabilityManifest } from '@ccc/contracts/runtime';
import type { AiReviewApi } from './ai-review';
import type { MyIdentity, SettingsApi } from './api';
import type { CloudAuth } from './auth';
import type { InstitutionApi } from './institution';
import type { ParticipantsApi } from './participants';
import type { ConsentApi } from './consent';
import type { IntakeApi } from './intake';
import type { InvitesApi, PublicJoinApi } from './invites';
import type { CaseWorkApi, RecordsApi } from './records';
import type { SchedulesApi } from './schedules';

/** 한 인증 상태에 속한 업무 화면의 입력. 토큰은 담지 않는다. */
export interface Session {
  auth: CloudAuth;
  api: SettingsApi;
  participants: ParticipantsApi;
  schedules: SchedulesApi;
  records: RecordsApi;
  caseWork: CaseWorkApi;
  intake: IntakeApi;
  consent: ConsentApi;
  invites: InvitesApi;
  aiReview: AiReviewApi;
  institution: InstitutionApi;
  me: MyIdentity;
  capabilities: CapabilityManifest;
  /** 초기 설정이나 도입 확인을 저장한 뒤 /me의 준비 관측값을 다시 읽는다. */
  reloadIdentity: () => void;
}

/** 토큰만 갖고 도는 공개 화면의 입력. 업무 세션과 섞지 않는다. */
export interface PublicSession {
  publicJoin: PublicJoinApi;
}
