import type { CapabilityManifest } from '@ccc/contracts/runtime';
import type { MyIdentity, SettingsApi } from './api';
import type { CloudAuth } from './auth';
import type { InstitutionApi } from './institution';
import type { ParticipantsApi } from './participants';

/** 한 인증 상태에 속한 업무 화면의 입력. 토큰은 담지 않는다. */
export interface Session {
  auth: CloudAuth;
  api: SettingsApi;
  participants: ParticipantsApi;
  institution: InstitutionApi;
  me: MyIdentity;
  capabilities: CapabilityManifest;
  /** 초기 설정이나 도입 확인을 저장한 뒤 /me의 준비 관측값을 다시 읽는다. */
  reloadIdentity: () => void;
}
