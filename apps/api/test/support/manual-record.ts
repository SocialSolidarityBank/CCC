import type { Actor, CounselingRecord, CounselingRecordGasScoreInput, CounselingRecordActionItemInput, CounselingRecordFlagInput, LifeAreaSnapshotEntry, ActionItemResolutionStatus } from '@ccc/core/gateway';
import type { Database } from '@ccc/contracts/database';
import { sha256Hex } from '@ccc/contracts/consent';

/** Stored v1 facts only. This fixture never calls or emulates the retired production writer. */
export async function seedLegacyManualRecord(env: { DB: Database }, actor: Actor, supportCaseId: string, input: {
  submissionId?: string;
  heldAt: string;
  channel: 'in_person' | 'phone' | 'video';
  memo: string;
  details?: Record<string, string>;
  lifeAreas?: Array<Omit<LifeAreaSnapshotEntry, 'note'> & { note?: string }>;
  gasScores?: CounselingRecordGasScoreInput[];
  actionItems?: CounselingRecordActionItemInput[];
  flags?: CounselingRecordFlagInput[];
  actionItemResolutions?: Array<{ actionItemId: string; status: ActionItemResolutionStatus; note?: string }>;
}): Promise<{ record: CounselingRecord; replayed: false }> {
  const id = crypto.randomUUID();
  const at = input.heldAt;
  const statements = [env.DB.prepare(`INSERT INTO sessions
    (id, org_id, support_case_id, counselor_id, held_at, channel, memo, record_details, submission_id, submission_hash, submitted_by, ai_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', ?, ?)`)
    .bind(id, actor.orgId, supportCaseId, actor.userId, at, input.channel, input.memo,
      input.details === undefined ? null : JSON.stringify(input.details), input.submissionId ?? crypto.randomUUID(),
      await sha256Hex(JSON.stringify(input)), actor.userId, at, at)];
  for (const area of input.lifeAreas ?? []) statements.push(env.DB.prepare(`INSERT INTO session_life_area_snapshots
    (id, org_id, session_id, area_key, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), actor.orgId, id, area.areaKey, area.status, area.note ?? null, at));
  for (const action of input.actionItems ?? []) statements.push(env.DB.prepare(`INSERT INTO action_items
    (id, org_id, support_case_id, session_id, description, owner, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), actor.orgId, supportCaseId, id, action.description, action.owner, action.dueDate ?? null, at));
  for (const score of input.gasScores ?? []) statements.push(env.DB.prepare(`INSERT INTO session_goal_scores
    (id, org_id, session_id, goal_id, score, scored_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), actor.orgId, id, score.goalId, score.score, actor.userId, at));
  for (const flag of input.flags ?? []) statements.push(env.DB.prepare(`INSERT INTO flags
    (id, org_id, support_case_id, session_id, flag_type, quote, source, review_status, reviewed_by, reviewed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'counselor', 'confirmed', ?, ?, ?)`)
    .bind(crypto.randomUUID(), actor.orgId, supportCaseId, id, flag.flagType, flag.quote ?? null, actor.userId, at, at));
  for (const resolution of input.actionItemResolutions ?? []) statements.push(env.DB.prepare(`UPDATE action_items
    SET resolution_status = ?, resolution_note = ?, resolution_at = ?, resolution_session_id = ?, resolved_at = ?, resolved_by = ?
    WHERE id = ? AND org_id = ? AND support_case_id = ?`)
    .bind(resolution.status, resolution.note ?? null, at, id, resolution.status === 'done' ? at : null,
      resolution.status === 'done' ? actor.userId : null, resolution.actionItemId, actor.orgId, supportCaseId));
  await env.DB.batch(statements);
  return { record: { id, supportCaseId, counselorId: actor.userId, heldAt: at, channel: input.channel, memo: input.memo,
    kind: 'regular', aiSummary: null, approvedAt: null, createdAt: at }, replayed: false };
}
