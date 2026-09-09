import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Icon, WireButton, WireCallout, WireCard, WireDataRow, WireDataRows, WireEmpty, WireError, WireFormField,
} from '@ccc/web/wire';
import { BusinessError, safeError } from './errors';
import { BusinessTransport } from './transport';

/** New values stay within the existing five-year calendar retention cap. */
export const RETENTION_POLICY_MAX_DAYS = 1826;
const RETENTION_POLICY_STORAGE_MAX_DAYS = 3660;

export interface RetentionPolicy {
  orgId: string;
  piiPurgeGraceDays: number;
  version: number;
}

export interface RetentionPolicyInput {
  expectedVersion: number;
  piiPurgeGraceDays: number;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new BusinessError('invalid_response');
  return value as Record<string, unknown>;
}
function safeOrgId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 200
    && !/[\u0000-\u001f\u007f]/u.test(value);
}
function decodeRetentionPolicy(value: unknown): RetentionPolicy {
  const row = record(value);
  const keys = ['orgId', 'piiPurgeGraceDays', 'version'];
  if (Object.keys(row).length !== keys.length || !keys.every((key) => Object.hasOwn(row, key))
    || !safeOrgId(row.orgId)
    || typeof row.piiPurgeGraceDays !== 'number'
    || !Number.isSafeInteger(row.piiPurgeGraceDays)
    || row.piiPurgeGraceDays < 1 || row.piiPurgeGraceDays > RETENTION_POLICY_STORAGE_MAX_DAYS
    || typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1) {
    throw new BusinessError('invalid_response');
  }
  return {
    orgId: row.orgId,
    piiPurgeGraceDays: row.piiPurgeGraceDays,
    version: row.version,
  };
}

/** Authenticated transport for the IA-only retention policy endpoints. */
export class RetentionPolicyApi {
  constructor(private readonly transport: BusinessTransport) {}

  async get(): Promise<RetentionPolicy> {
    return decodeRetentionPolicy(await this.transport.request('/settings/retention-policy'));
  }

  async save(input: RetentionPolicyInput): Promise<RetentionPolicy> {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1
      || !Number.isSafeInteger(input.piiPurgeGraceDays)
      || input.piiPurgeGraceDays < 1 || input.piiPurgeGraceDays > RETENTION_POLICY_MAX_DAYS) {
      throw new BusinessError('invalid_request', 400);
    }
    return decodeRetentionPolicy(await this.transport.request('/settings/retention-policy', 'PUT', {
      expectedVersion: input.expectedVersion,
      piiPurgeGraceDays: input.piiPurgeGraceDays,
    }));
  }
}

/**
 * Duration editor, deliberately separate from RetentionModule's review queue.
 * The stored policy is shown independently from the editable draft so an old
 * out-of-bound value can be displayed honestly without being endorsed as a new
 * valid choice.
 */
export function RetentionPolicyModule({ api, onFailure }: {
  api: RetentionPolicyApi;
  onFailure: (error: BusinessError) => void;
}) {
  const [policy, setPolicy] = useState<RetentionPolicy | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(true);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);
  const [saved, setSaved] = useState(false);
  const generation = useRef(0);
  const busyRef = useRef(false);

  async function refresh(): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    const own = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const current = await api.get();
      if (own !== generation.current) return;
      setPolicy(current);
      setDraft(String(current.piiPurgeGraceDays));
      setNeedsRefresh(false);
      setSaved(false);
    } catch (cause) {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      setError(safe);
      onFailure(safe);
    } finally {
      if (own === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  useEffect(() => {
    busyRef.current = false;
    void refresh();
    return () => { generation.current += 1; };
  }, [api]);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busyRef.current || policy === null || needsRefresh) return;
    const days = Number(draft.trim());
    if (!Number.isSafeInteger(days) || days < 1 || days > RETENTION_POLICY_MAX_DAYS) {
      const invalid = new BusinessError('invalid_request', 400);
      setError(invalid);
      return;
    }
    busyRef.current = true;
    const own = ++generation.current;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api.save({ expectedVersion: policy.version, piiPurgeGraceDays: days });
      if (own !== generation.current) return;
      setPolicy(updated);
      setDraft(String(updated.piiPurgeGraceDays));
      setNeedsRefresh(false);
      setSaved(true);
    } catch (cause) {
      if (own !== generation.current) return;
      // Keep the draft and require an explicit readback after every uncertain
      // write, especially 409 CAS conflicts. No optimistic stored-value change.
      const safe = safeError(cause);
      setError(safe);
      setNeedsRefresh(true);
      onFailure(safe);
    } finally {
      if (own === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  return <WireCard as="section" labelledBy="retention-policy-title" title={<h2 id="retention-policy-title">보존 기간 설정</h2>}>
    <WireCallout tone="info" title="향후 종결 케이스에 적용">
      앞으로 당사자의 모든 지원 사례가 종결될 때 적용할 개인정보 보존 기간입니다. 이미 정해진 검토 예정일이나 법적 보존 결정은 바꾸지 않습니다.
    </WireCallout>
    {policy !== null && <WireDataRows>
      <WireDataRow label="현재 저장값" value={`${policy.piiPurgeGraceDays}일`} />
      <WireDataRow label="정책 버전" value={String(policy.version)} />
    </WireDataRows>}
    {policy !== null && policy.piiPurgeGraceDays > RETENTION_POLICY_MAX_DAYS && <WireCallout tone="info" title="기존 저장값 참고">
      현재 값은 이전 설치에서 저장된 {policy.piiPurgeGraceDays}일입니다. 새로 저장할 때는 1~{RETENTION_POLICY_MAX_DAYS}일을 고릅니다. 실제 보존 기한은 종결 후 5년을 넘지 않도록 계산합니다.
    </WireCallout>}
    {error && <WireError>{error.message}</WireError>}
    {saved && <WireEmpty live>보존 기간 설정을 저장했습니다.</WireEmpty>}
    {busy && <WireEmpty live>보존 기간 설정을 확인하고 있습니다.</WireEmpty>}
    {policy !== null && !busy && <form className="business-form" onSubmit={(event) => { void save(event); }}>
      <WireFormField label="종결 후 기본 보존 기간(일)" htmlFor="retention-policy-days" required hint={`1~${RETENTION_POLICY_MAX_DAYS}일. 실제 보존 기한은 종결 후 5년을 넘지 않습니다.`}>
        <input id="retention-policy-days" type="number" min={1} max={RETENTION_POLICY_MAX_DAYS} step={1} value={draft}
          required disabled={busy || needsRefresh} onChange={(event) => setDraft(event.target.value)} />
      </WireFormField>
      <div className="business-actions">
        <WireButton variant="primary" icon={<Icon name="check" />} type="submit" disabled={busy || needsRefresh}>저장</WireButton>
        <WireButton variant="neutral" type="button" disabled={busy} onClick={() => { void refresh(); }}>최신 정보 확인</WireButton>
      </div>
    </form>}
    {policy === null && !busy && <WireButton variant="neutral" disabled={busy} onClick={() => { void refresh(); }}>최신 정보 확인</WireButton>}
    {needsRefresh && <WireCallout tone="info" title="저장 전에 최신 정보를 확인해 주세요">
      다른 변경이 먼저 저장되었거나 저장 결과를 확인하지 못했습니다. 입력한 값은 남아 있으니 최신 정보를 확인한 뒤 다시 저장해 주세요.
    </WireCallout>}
    <WireCallout tone="info" title="기존 검토 큐와 별도">
      아래 개인정보 보존 검토는 이미 유예 기간이 끝난 자료의 보존·파기 결정을 처리합니다. 이 화면은 그 큐의 결정을 대신하지 않습니다.
    </WireCallout>
  </WireCard>;
}
