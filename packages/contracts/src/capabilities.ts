/**
 * CapabilityManifest 생성과 검증 (S2 §2.8, E1-7).
 *
 * builder 는 서버가, decoder 는 client 가 쓴다. 둘 다 signed engine registry 만 믿는다.
 * 응답에는 키 이름·값·hash, token, endpoint credential, orgId, userId, email 이 없다.
 */
import {
  type AgentStatus,
  type ApprovedSttEngineEntry,
  type ApprovedSttEngineId,
  type CapabilityDisabledReason,
  type CapabilityFeature,
  type CapabilityManifest,
  type CapabilityOption,
  DEPLOYMENT_MODES,
  type DeploymentMode,
  LLM_MODES,
  type LlmMode,
  STT_MODES,
  type SttMode,
} from './runtime';
import { isRecord } from './guards';

export class CapabilityManifestError extends Error {}

const AGENT_STATUSES: readonly AgentStatus[] = ['connected', 'delayed', 'authentication_error', 'quota_exceeded', 'inactive'];
const DISABLED_REASONS: readonly CapabilityDisabledReason[] = ['unverified', 'missing_key', 'unsupported', null];
const FEATURE_KEYS: readonly CapabilityFeature[] = ['recording', 'multi_user', 'offline', 'public_signup', 'cloud_audio_temp', 'ai_draft'];
const MANIFEST_KEYS = ['schemaVersion', 'mode', 'sttMode', 'sttEngine', 'sttOptions', 'llmMode', 'llmOptions', 'features', 'agentStatus'] as const;
const OPTION_KEYS = ['mode', 'enabled', 'disabledReason'] as const;
/** URL, credential, 임의 문자열은 engine ID 가 될 수 없다. */
const ENGINE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ENGINE_ID_FORBIDDEN = ['://', '?', '@', 'bearer', 'key'];

export function isValidSttEngineIdShape(id: string): boolean {
  const lower = id.toLowerCase();
  return ENGINE_ID_PATTERN.test(id) && !ENGINE_ID_FORBIDDEN.some((part) => lower.includes(part));
}

/** registry 의 exact `{id, mode}` member 만 brand 를 얻는다. local ID 를 azure 로, 그 반대로 쓸 수 없다. */
export function approvedSttEngineId(
  registry: readonly ApprovedSttEngineEntry[],
  id: string,
  mode: 'local' | 'azure',
): ApprovedSttEngineId {
  if (!isValidSttEngineIdShape(id)) throw new CapabilityManifestError('stt engine id is invalid');
  if (!registry.some((entry) => entry.id === id && entry.mode === mode)) {
    throw new CapabilityManifestError('stt engine is not in the signed registry');
  }
  return id as ApprovedSttEngineId;
}

export interface CapabilityInput {
  mode: DeploymentMode;
  requestedSttMode: SttMode;
  requestedLlmMode: LlmMode;
  registry: readonly ApprovedSttEngineEntry[];
  /** STT-G1~G3/Q 승인(local)과 Azure 외부 처리 gate(azure)가 지났는가. 지나기 전에는 `unverified` 다. */
  sttGatePassed: Record<'local' | 'azure', boolean>;
  /** Agent 가 보고한 Azure 자격 존재 여부. 값은 Python SecretStore 에만 있고 TypeScript 는 존재 여부만 안다. */
  azureKeyPresent: boolean;
  llmKeyPresent: boolean;
  /** 텍스트 AI 파일럿·외부 호출 스위치 등 동의 gate 가 모두 열려 있는가. */
  llmGateOpen: boolean;
  agentStatus: AgentStatus;
  publicSignupEnabled: boolean;
}

function sttOption(input: CapabilityInput, mode: SttMode): CapabilityOption<SttMode> & { engine: ApprovedSttEngineId | null } {
  if (mode === 'off') return { mode, enabled: true, disabledReason: null, engine: null };
  const entry = input.registry.find((candidate) => candidate.mode === mode);
  // S2 §2.8: gate 전 unverified → gate 후 entry 없음 unsupported → entry 있고 key 없음 missing_key.
  // AI 를 켜려면 Agent 가 붙어 있어야 하므로 Agent 없음도 unsupported 다.
  let reason: CapabilityDisabledReason = null;
  if (!input.sttGatePassed[mode]) reason = 'unverified';
  else if (entry === undefined || input.agentStatus === 'inactive') reason = 'unsupported';
  else if (mode === 'azure' && !input.azureKeyPresent) reason = 'missing_key';
  return {
    mode,
    enabled: reason === null,
    disabledReason: reason,
    engine: reason === null && entry !== undefined ? approvedSttEngineId(input.registry, entry.id, mode) : null,
  };
}

function llmOption(input: CapabilityInput, mode: LlmMode): CapabilityOption<LlmMode> {
  if (mode === 'off') return { mode, enabled: true, disabledReason: null };
  let reason: CapabilityDisabledReason = null;
  if (!input.llmKeyPresent) reason = 'missing_key';
  else if (!input.llmGateOpen || input.agentStatus === 'inactive') reason = 'unsupported';
  return { mode, enabled: reason === null, disabledReason: reason };
}

export function buildCapabilityManifest(input: CapabilityInput): CapabilityManifest {
  const sttOptions = STT_MODES.map((mode) => sttOption(input, mode));
  const llmOptions = LLM_MODES.map((mode) => llmOption(input, mode));
  const selectedStt = sttOptions.find((option) => option.mode === input.requestedSttMode && option.enabled) ?? sttOptions[0]!;
  const selectedLlm = llmOptions.find((option) => option.mode === input.requestedLlmMode && option.enabled) ?? llmOptions[0]!;
  const aiOn = selectedStt.mode !== 'off' || selectedLlm.mode !== 'off';
  return {
    schemaVersion: 1,
    mode: input.mode,
    sttMode: selectedStt.mode,
    sttEngine: selectedStt.engine,
    sttOptions: sttOptions.map(({ mode, enabled, disabledReason }) => ({ mode, enabled, disabledReason })),
    llmMode: selectedLlm.mode,
    llmOptions,
    features: {
      recording: true,
      multi_user: input.mode !== 'local-single',
      offline: input.mode !== 'community-cloud',
      public_signup: input.publicSignupEnabled,
      cloud_audio_temp: input.mode === 'community-cloud',
      ai_draft: selectedLlm.mode === 'openai',
    },
    // 두 축이 모두 off 면 Agent 는 필요 없으므로 inactive 다. 켜져 있으면 option gate 가 이미 inactive 를 막았다.
    agentStatus: aiOn ? input.agentStatus : 'inactive',
  };
}

function assertExactKeys(record: Record<string, unknown>, keys: readonly string[], what: string): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new CapabilityManifestError(`${what} keys are invalid`);
  }
}

function decodeOptions<M extends string>(value: unknown, modes: readonly M[], what: string): Array<CapabilityOption<M>> {
  if (!Array.isArray(value) || value.length !== modes.length) throw new CapabilityManifestError(`${what} is invalid`);
  return value.map((item, index) => {
    if (!isRecord(item)) throw new CapabilityManifestError(`${what} is invalid`);
    assertExactKeys(item, OPTION_KEYS, what);
    const { mode, enabled, disabledReason } = item;
    if (mode !== modes[index]) throw new CapabilityManifestError(`${what} order is invalid`);
    if (typeof enabled !== 'boolean') throw new CapabilityManifestError(`${what} enabled is invalid`);
    if (!DISABLED_REASONS.includes(disabledReason as CapabilityDisabledReason)) throw new CapabilityManifestError(`${what} reason is invalid`);
    if (enabled !== (disabledReason === null)) throw new CapabilityManifestError(`${what} enabled/reason mismatch`);
    return { mode: mode as M, enabled, disabledReason: disabledReason as CapabilityDisabledReason };
  });
}

function assertSelected<M extends string>(options: Array<CapabilityOption<M>>, mode: M, what: string): void {
  const option = options.find((candidate) => candidate.mode === mode);
  if (option === undefined || !option.enabled) throw new CapabilityManifestError(`${what} selection is not enabled`);
}

/**
 * 서버 응답을 exact schema 와 S2 불변식으로 검증한다. `sttEngine` 은 signed registry 의
 * 같은 `{id, mode}` entry 와 정확히 일치해야 한다.
 */
export function decodeCapabilityManifest(value: unknown, registry: readonly ApprovedSttEngineEntry[]): CapabilityManifest {
  if (!isRecord(value)) throw new CapabilityManifestError('capability manifest is invalid');
  assertExactKeys(value, MANIFEST_KEYS, 'capability manifest');
  if (value.schemaVersion !== 1) throw new CapabilityManifestError('schemaVersion is invalid');
  const mode = value.mode;
  if (!DEPLOYMENT_MODES.includes(mode as DeploymentMode)) throw new CapabilityManifestError('mode is invalid');
  const sttMode = value.sttMode;
  if (!STT_MODES.includes(sttMode as SttMode)) throw new CapabilityManifestError('sttMode is invalid');
  const llmMode = value.llmMode;
  if (!LLM_MODES.includes(llmMode as LlmMode)) throw new CapabilityManifestError('llmMode is invalid');
  const sttOptions = decodeOptions(value.sttOptions, STT_MODES, 'sttOptions');
  const llmOptions = decodeOptions(value.llmOptions, LLM_MODES, 'llmOptions');
  assertSelected(sttOptions, sttMode as SttMode, 'sttMode');
  assertSelected(llmOptions, llmMode as LlmMode, 'llmMode');

  let sttEngine: ApprovedSttEngineId | null = null;
  if (sttMode === 'off') {
    if (value.sttEngine !== null) throw new CapabilityManifestError('sttEngine must be null when sttMode is off');
  } else {
    if (typeof value.sttEngine !== 'string') throw new CapabilityManifestError('sttEngine is invalid');
    sttEngine = approvedSttEngineId(registry, value.sttEngine, sttMode as 'local' | 'azure');
  }

  if (!isRecord(value.features)) throw new CapabilityManifestError('features is invalid');
  assertExactKeys(value.features, FEATURE_KEYS, 'features');
  const features = {} as Record<CapabilityFeature, boolean>;
  for (const key of FEATURE_KEYS) {
    const flag = value.features[key];
    if (typeof flag !== 'boolean') throw new CapabilityManifestError(`features.${key} is invalid`);
    features[key] = flag;
  }
  const expectedFeatures: Partial<Record<CapabilityFeature, boolean>> = {
    recording: true,
    multi_user: mode !== 'local-single',
    offline: mode !== 'community-cloud',
    cloud_audio_temp: mode === 'community-cloud',
    ai_draft: llmMode === 'openai',
  };
  for (const [key, expected] of Object.entries(expectedFeatures)) {
    if (features[key as CapabilityFeature] !== expected) throw new CapabilityManifestError(`features.${key} violates the mode invariant`);
  }

  const agentStatus = value.agentStatus;
  if (!AGENT_STATUSES.includes(agentStatus as AgentStatus)) throw new CapabilityManifestError('agentStatus is invalid');
  const aiOn = sttMode !== 'off' || llmMode !== 'off';
  if (aiOn && agentStatus === 'inactive') throw new CapabilityManifestError('agentStatus cannot be inactive while AI is on');
  if (!aiOn && agentStatus !== 'inactive') throw new CapabilityManifestError('agentStatus must be inactive while AI is off');

  return {
    schemaVersion: 1,
    mode: mode as DeploymentMode,
    sttMode: sttMode as SttMode,
    sttEngine,
    sttOptions,
    llmMode: llmMode as LlmMode,
    llmOptions,
    features,
    agentStatus: agentStatus as AgentStatus,
  };
}
