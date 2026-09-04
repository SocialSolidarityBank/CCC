import { describe, expect, it } from 'vitest';
import {
  buildCapabilityManifest,
  CapabilityManifestError,
  type CapabilityInput,
  decodeCapabilityManifest,
} from '@ccc/contracts/capabilities';
import type { AgentStatus, ApprovedSttEngineEntry, DeploymentMode, LlmMode, SttMode } from '@ccc/contracts/runtime';
import worker from './support/local-worker';
import { setupD1 } from './support/d1';
import {
  createTestSigner,
  signedManifest,
  SYNTHETIC_AZURE_REGISTRY,
  SYNTHETIC_LOCAL_REGISTRY,
  TEST_INSTALLATION_ID,
} from './support/install-manifest';

// S2 §2.8 — 18개 조합. registry 는 fixture 에만 주입하는 synthetic 이고 production 은 비어 있다.
type Row = [number, DeploymentMode, 'registry-empty' | 'local' | 'azure', SttMode, LlmMode, SttMode, string | null, LlmMode, AgentStatus];
const MODES: DeploymentMode[] = ['community-cloud', 'local-single', 'local-office'];
const ROWS: Row[] = MODES.flatMap((mode, modeIndex): Row[] => [
  [modeIndex * 6 + 1, mode, 'registry-empty', 'off', 'off', 'off', null, 'off', 'inactive'],
  [modeIndex * 6 + 2, mode, 'registry-empty', 'off', 'openai', 'off', null, 'openai', 'connected'],
  [modeIndex * 6 + 3, mode, 'local', 'local', 'off', 'local', 'local-whisper-medium', 'off', 'connected'],
  [modeIndex * 6 + 4, mode, 'local', 'local', 'openai', 'local', 'local-whisper-medium', 'openai', 'connected'],
  [modeIndex * 6 + 5, mode, 'azure', 'azure', 'off', 'azure', 'azure-speech-koreacentral', 'off', 'connected'],
  [modeIndex * 6 + 6, mode, 'azure', 'azure', 'openai', 'azure', 'azure-speech-koreacentral', 'openai', 'connected'],
]);
const REGISTRIES: Record<Row[2], ApprovedSttEngineEntry[]> = {
  'registry-empty': [],
  local: SYNTHETIC_LOCAL_REGISTRY,
  azure: SYNTHETIC_AZURE_REGISTRY,
};
const FORBIDDEN_KEYS = ['orgId', 'userId', 'email', 'token', 'secret', 'apiKey', 'key', 'hash', 'endpoint', 'apiBase'];

function collectKeys(value: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => collectKeys(item, into));
  else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      collectKeys(child, into);
    }
  }
  return into;
}

function inputFor(row: Row): CapabilityInput {
  const [, mode, registry, requestedSttMode, requestedLlmMode] = row;
  return {
    mode,
    requestedSttMode,
    requestedLlmMode,
    registry: REGISTRIES[registry],
    sttGatePassed: { local: registry === 'local', azure: registry === 'azure' },
    azureKeyPresent: true,
    llmKeyPresent: true,
    llmGateOpen: true,
    // fixture 는 Agent 가 붙어 있는 환경. 두 축이 모두 off 인 row 만 builder 가 inactive 로 내린다.
    agentStatus: 'connected',
    publicSignupEnabled: false,
  };
}

describe('CapabilityManifest 18 combinations (S2 §2.8)', () => {
  it.each(ROWS)('#%i %s %s stt=%s llm=%s', (...row) => {
    const [, mode, registry, , , actualStt, actualEngine, actualLlm, agentStatus] = row;
    const manifest = buildCapabilityManifest(inputFor(row));
    expect(manifest.mode).toBe(mode);
    expect(manifest.sttMode).toBe(actualStt);
    expect(manifest.sttEngine).toBe(actualEngine);
    expect(manifest.llmMode).toBe(actualLlm);
    expect(manifest.agentStatus).toBe(agentStatus);
    expect(manifest.sttOptions.map((option) => option.mode)).toEqual(['off', 'local', 'azure']);
    expect(manifest.llmOptions.map((option) => option.mode)).toEqual(['off', 'openai']);
    expect(manifest.features.ai_draft).toBe(actualLlm === 'openai');
    expect(manifest.features.recording).toBe(true);
    expect(manifest.features.multi_user).toBe(mode !== 'local-single');
    expect(manifest.features.offline).toBe(mode !== 'community-cloud');
    expect(manifest.features.cloud_audio_temp).toBe(mode === 'community-cloud');
    // decoder 는 같은 registry 로 round-trip 해야 한다.
    expect(decodeCapabilityManifest(JSON.parse(JSON.stringify(manifest)), REGISTRIES[registry])).toEqual(manifest);
    const keys = collectKeys(manifest, new Set());
    expect([...keys].filter((key) => FORBIDDEN_KEYS.includes(key))).toEqual([]);
  });

  it('shares one exact key set across the three modes', () => {
    const keySets = MODES.map((mode) => JSON.stringify([...collectKeys(buildCapabilityManifest(inputFor(ROWS.find((row) => row[1] === mode)!)), new Set())].sort()));
    expect(new Set(keySets).size).toBe(1);
  });

  it('pre-Q production output is off/null with unverified local and azure in every mode', () => {
    for (const mode of MODES) {
      const manifest = buildCapabilityManifest({
        ...inputFor([0, mode, 'registry-empty', 'azure', 'off', 'off', null, 'off', 'inactive']),
        agentStatus: 'connected',
      });
      expect(manifest.sttMode).toBe('off');
      expect(manifest.sttEngine).toBeNull();
      expect(manifest.sttOptions.slice(1)).toEqual([
        { mode: 'local', enabled: false, disabledReason: 'unverified' },
        { mode: 'azure', enabled: false, disabledReason: 'unverified' },
      ]);
      expect(manifest.agentStatus).toBe('inactive');
    }
  });

  it('reports deterministic disabled reasons', () => {
    const base = inputFor(ROWS[4]!); // cloud, azure registry, requested azure
    expect(buildCapabilityManifest({ ...base, azureKeyPresent: false }).sttOptions[2]).toEqual({ mode: 'azure', enabled: false, disabledReason: 'missing_key' });
    expect(buildCapabilityManifest({ ...base, agentStatus: 'inactive' }).sttOptions[2]).toEqual({ mode: 'azure', enabled: false, disabledReason: 'unsupported' });
    // gate 는 지났는데 signed registry 에 entry 가 없는 상태(S2 §2.8 두 번째 단).
    expect(buildCapabilityManifest({ ...base, registry: [] }).sttOptions[2]).toEqual({ mode: 'azure', enabled: false, disabledReason: 'unsupported' });
    // entry 는 있는데 gate 표시가 없으면 entry 를 믿지 않는다.
    expect(buildCapabilityManifest({ ...base, sttGatePassed: { local: false, azure: false } }).sttOptions[2]).toEqual({ mode: 'azure', enabled: false, disabledReason: 'unverified' });
    const llm = inputFor(ROWS[1]!); // cloud, requested openai
    expect(buildCapabilityManifest({ ...llm, llmKeyPresent: false }).llmOptions[1]).toEqual({ mode: 'openai', enabled: false, disabledReason: 'missing_key' });
    expect(buildCapabilityManifest({ ...llm, llmGateOpen: false }).llmOptions[1]).toEqual({ mode: 'openai', enabled: false, disabledReason: 'unsupported' });
    const fallen = buildCapabilityManifest({ ...llm, llmGateOpen: false });
    expect(fallen.llmMode).toBe('off');
    expect(fallen.features.ai_draft).toBe(false);
    expect(fallen.agentStatus).toBe('inactive');
  });
});

describe('decodeCapabilityManifest rejections', () => {
  const valid = () => JSON.parse(JSON.stringify(buildCapabilityManifest(inputFor(ROWS[2]!)))) as Record<string, unknown>;

  it('stt-azure-id-as-local-reject and stt-local-id-as-azure-reject', () => {
    const asLocal = { ...valid(), sttEngine: 'azure-speech-koreacentral' };
    expect(() => decodeCapabilityManifest(asLocal, [...SYNTHETIC_LOCAL_REGISTRY, ...SYNTHETIC_AZURE_REGISTRY])).toThrow(CapabilityManifestError);
    const azureRow = JSON.parse(JSON.stringify(buildCapabilityManifest(inputFor(ROWS[4]!)))) as Record<string, unknown>;
    const asAzure = { ...azureRow, sttEngine: 'local-whisper-medium' };
    expect(() => decodeCapabilityManifest(asAzure, [...SYNTHETIC_LOCAL_REGISTRY, ...SYNTHETIC_AZURE_REGISTRY])).toThrow(CapabilityManifestError);
  });

  it('rejects engines outside the signed registry, URLs and credentials', () => {
    expect(() => decodeCapabilityManifest(valid(), [])).toThrow('not in the signed registry');
    for (const bad of ['https://stt.example/v1', 'engine?x=1', 'user@host', 'Bearer-abc', 'apikey-123']) {
      expect(() => decodeCapabilityManifest({ ...valid(), sttEngine: bad }, [{ id: bad, mode: 'local' }])).toThrow(CapabilityManifestError);
    }
  });

  it('rejects extra keys, wrong option order and broken invariants', () => {
    expect(() => decodeCapabilityManifest({ ...valid(), orgId: 'org_demo' }, SYNTHETIC_LOCAL_REGISTRY)).toThrow('keys are invalid');
    const reordered = valid();
    reordered.sttOptions = (reordered.sttOptions as unknown[]).slice().reverse();
    expect(() => decodeCapabilityManifest(reordered, SYNTHETIC_LOCAL_REGISTRY)).toThrow('order is invalid');
    expect(() => decodeCapabilityManifest({ ...valid(), agentStatus: 'inactive' }, SYNTHETIC_LOCAL_REGISTRY)).toThrow('cannot be inactive');
    const offRow = JSON.parse(JSON.stringify(buildCapabilityManifest(inputFor(ROWS[0]!)))) as Record<string, unknown>;
    expect(() => decodeCapabilityManifest({ ...offRow, agentStatus: 'connected' }, [])).toThrow('must be inactive');
    const features = { ...(valid().features as Record<string, boolean>), ai_draft: true };
    expect(() => decodeCapabilityManifest({ ...valid(), features }, SYNTHETIC_LOCAL_REGISTRY)).toThrow('violates the mode invariant');
  });
});

describe('GET /capabilities', () => {
  const t = setupD1();
  const counselor = { 'X-CCC-User-Id': 'counselor@example.invalid', 'X-CCC-Org-Id': 'org_demo', 'X-CCC-Role': 'counselor' };
  const service = { ...counselor, 'X-CCC-Role': 'service' };

  async function envWithManifest(mode: DeploymentMode) {
    await t.reset();
    const signer = await createTestSigner();
    const manifest = await signedManifest(signer, mode, { approvedSttEngineIds: SYNTHETIC_LOCAL_REGISTRY });
    return {
      ...t.env,
      CCC_INSTALL_MANIFEST: JSON.stringify(manifest),
      CCC_INSTALL_SIGNING_KEYS: JSON.stringify(signer.publicKeys),
      CCC_STT_MODE: 'local',
    };
  }

  it('answers a human with no-store, the installation header and a decodable body', async () => {
    const env = await envWithManifest('local-office');
    const response = await worker.fetch(new Request('http://localhost/capabilities', { headers: counselor }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-ccc-installation-id')).toBe(TEST_INSTALLATION_ID);
    const body = await response.json();
    const decoded = decodeCapabilityManifest(body, SYNTHETIC_LOCAL_REGISTRY);
    expect(decoded.mode).toBe('local-office');
    // 빈 DB 는 Agent 폴링 흔적이 없어 inactive → local 은 unsupported 로 내려가고 off 가 선택된다.
    // azure 는 registry 에 entry 가 없으니 unverified 다.
    expect(decoded.sttMode).toBe('off');
    expect(decoded.sttOptions[1]).toEqual({ mode: 'local', enabled: false, disabledReason: 'unsupported' });
    expect(decoded.sttOptions[2]).toEqual({ mode: 'azure', enabled: false, disabledReason: 'unverified' });
    expect(decoded.agentStatus).toBe('inactive');
    const text = JSON.stringify(body);
    for (const needle of ['org_demo', 'counselor@example.invalid', TEST_INSTALLATION_ID, 'sb_publishable', 'supabase']) {
      expect(text).not.toContain(needle);
    }
  });

  it('refuses the Agent with 403', async () => {
    const env = await envWithManifest('community-cloud');
    const response = await worker.fetch(new Request('http://localhost/capabilities', { headers: service }), env);
    expect(response.status).toBe(403);
    expect(response.headers.get('x-ccc-installation-id')).toBeNull();
  });

  it('fails closed with 503 when the manifest is missing or tampered', async () => {
    await t.reset();
    const missing = await worker.fetch(new Request('http://localhost/capabilities', { headers: counselor }), t.env);
    expect(missing.status).toBe(503);
    await expect(missing.json()).resolves.toEqual({ error: 'service_unavailable' });
    const env = await envWithManifest('local-single');
    const tampered = { ...JSON.parse(env.CCC_INSTALL_MANIFEST), installationId: 'attacker-install' };
    const response = await worker.fetch(
      new Request('http://localhost/capabilities', { headers: counselor }),
      { ...env, CCC_INSTALL_MANIFEST: JSON.stringify(tampered) },
    );
    expect(response.status).toBe(503);
  });
});
