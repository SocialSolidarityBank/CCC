import type { Actor, CounselingRecord } from '@ccc/core/gateway';
import type { Database } from '@ccc/contracts/database';
import { sha256Hex } from '@ccc/contracts/consent';
import { INTAKE_WRITE_SCHEMA_VERSION, requiredIntakeQuestionKeys, type IntakeAnswer, type IntakeArea, type IntakeAdditionalItemRef, type IntakeCreateRequest, type IntakeModuleSnapshot, type IntakeQuestionnaire } from '@ccc/contracts/intake';

type Environment = { DB: Database };

export function intakeQuestionnaire(moduleSnapshot: IntakeModuleSnapshot, overrides: IntakeAnswer[] = []): IntakeQuestionnaire {
  const selection = overrides.find(answer => answer.key === 'difficulty_areas');
  const areas = selection?.response === 'answered' && 'choices' in selection ? selection.choices as IntakeArea[] : [];
  const answers: IntakeAnswer[] = requiredIntakeQuestionKeys(areas).map(key => ({ key, response: 'unknown' }));
  for (const answer of overrides) {
    const index = answers.findIndex(existing => existing.key === answer.key);
    if (index < 0) answers.push(answer); else answers[index] = answer;
  }
  return {
    schemaVersion: 2, moduleSnapshot, answers,
    linkedOrgs: { response: 'not_applicable' }, additionalItems: { response: 'not_applicable' },
    debts: moduleSnapshot.financialSupportEnabled && areas.includes('economy') ? { response: 'not_applicable' } : null,
  };
}

export function newIntakeQuestionRefs(questionnaire: IntakeQuestionnaire): IntakeAdditionalItemRef[] {
  return questionnaire.additionalItems.response === 'answered'
    ? questionnaire.additionalItems.rows.map((_, rowIndex) => ({ rowIndex, questionId: null, expectedRevision: null }))
    : [];
}

export function legacyIntakeQuestionRefs(mappings: Array<{ rowIndex: number; legacySourceRowIndex: number }>): IntakeAdditionalItemRef[] {
  return mappings.map(mapping => ({ ...mapping, questionId: null, expectedRevision: null }));
}

/** Fixture lookup avoids adding a product PII-read audit to mutation tests. */
export async function intakeInput(env: Environment, actor: Actor, supportCaseId: string, overrides: Partial<IntakeCreateRequest> = {}): Promise<IntakeCreateRequest> {
  const program = await env.DB.prepare(`SELECT p.id, p.version, p.financial_support_enabled FROM programs AS p
    JOIN support_cases AS sc ON sc.program_id = p.id AND sc.org_id = p.org_id WHERE sc.id = ? AND sc.org_id = ?`)
    .bind(supportCaseId, actor.orgId).first<{ id: string; version: number; financial_support_enabled: number }>();
  if (program === null) throw new Error('intake fixture program is missing');
  const questionnaire = overrides.questionnaire
    ?? intakeQuestionnaire({ programId: program.id, programVersion: program.version, financialSupportEnabled: program.financial_support_enabled === 1 });
  return {
    schemaVersion: INTAKE_WRITE_SCHEMA_VERSION, submissionId: crypto.randomUUID(), heldAt: '2026-09-01T09:00:00.000Z', channel: 'in_person',
    questionnaire, additionalItemRefs: newIntakeQuestionRefs(questionnaire), questionWithdrawals: [],
    ...overrides,
  };
}

/** Historical fixtures are inserted as v1, never passed through the current writer or converted. */
export async function seedLegacyIntake(env: Environment, actor: Actor, supportCaseId: string, input: {
  submissionId: string; heldAt: string; channel: 'in_person' | 'phone' | 'video';
  lifeAreas?: Array<{ areaKey: string; status: string; note?: string }>;
  goals?: Array<{ title: string; scaleCriteria?: unknown }>;
  actionItems?: Array<{ description: string; owner: 'beneficiary' | 'counselor' | 'org'; dueDate?: string }>;
  [key: string]: unknown;
}): Promise<{ record: CounselingRecord; replayed: false }> {
  const id = crypto.randomUUID();
  const { submissionId, heldAt, channel, lifeAreas = [], goals = [], actionItems = [], ...details } = input;
  const at = heldAt;
  const submissionHash = await sha256Hex(JSON.stringify(input));
  const statements = [
    env.DB.prepare(`INSERT INTO sessions (id, org_id, support_case_id, counselor_id, held_at, channel, kind, intake_details,
      submission_id, submission_hash, submitted_by, ai_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'intake', ?, ?, ?, ?, 'none', ?, ?)`)
      .bind(id, actor.orgId, supportCaseId, actor.userId, heldAt, channel, JSON.stringify(details), submissionId, submissionHash, actor.userId, at, at),
    env.DB.prepare('UPDATE support_cases SET intake_at = ? WHERE id = ? AND org_id = ?').bind(heldAt, supportCaseId, actor.orgId),
    ...goals.map(goal => env.DB.prepare(`INSERT INTO goals (id, org_id, support_case_id, title, scale_criteria, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?)`)
      .bind(crypto.randomUUID(), actor.orgId, supportCaseId, goal.title, goal.scaleCriteria === undefined ? null : JSON.stringify(goal.scaleCriteria), at)),
    ...lifeAreas.map(area => env.DB.prepare(`INSERT INTO session_life_area_snapshots (id, org_id, session_id, area_key, status, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), actor.orgId, id, area.areaKey, area.status, area.note ?? null, at)),
    ...actionItems.map(action => env.DB.prepare(`INSERT INTO action_items (id, org_id, support_case_id, session_id, description, owner, due_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), actor.orgId, supportCaseId, id, action.description, action.owner, action.dueDate ?? null, at)),
  ];
  await env.DB.batch(statements);
  return { record: { id, supportCaseId, counselorId: actor.userId, heldAt, channel, memo: '', kind: 'intake', aiSummary: null, approvedAt: null, createdAt: at }, replayed: false };
}
