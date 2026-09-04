-- ============================================================================
-- 마이그레이션 0035: 호출 ① 재료 증빙과 대조 3종 저장 (D69 · ADR-0036 · CCC-102)
--
-- 무엇을 더하는가.
--   1) ai_draft_source_materials. 한 초안이 실제로 쓴 마스킹 스냅샷 **전부**의
--      id · 해시 · 종류. 단수 컬럼 ai_draft_versions.source_snapshot_id/hash 는
--      호환을 위해 그대로 두고(주 재료), 이 표가 그 위에 반대편 재료까지 얹는다.
--   2) ai_draft_contrast_axes. 대조 3종의 축별 결과. 초안 버전에 귀속되므로 승인
--      흐름(R2)이 초안과 함께 덮는다. 축 적용 여부는 AI 가 아니라 서버가 판정해
--      status 로 남긴다(ADR-0036 결정 2·3).
--   3) ai_evidence_links_insert_guard 교체. 근거 링크가 주 스냅샷뿐 아니라 그 초안의
--      재료 스냅샷에서도 나올 수 있게 넓힌다.
--
-- 왜 표를 재구축하지 않는가. 0033·0034 는 CHECK 을 바꿔야 해서 표를 통째로 갈았다.
-- 여기서는 ai_draft_versions 의 CHECK 을 건드리지 않는다. 이 표는 인바운드 참조가
-- 셋(ai_evidence_links · ai_review_events · 자기 parent_version_id)이고 인덱스 3종 ·
-- 트리거 3종이 딸려 있어 재구축 폭이 크다. 필요한 것은 트리거 한 개의 조건 완화뿐이라
-- DROP TRIGGER 후 재생성으로 끝낸다.
--
-- 인용은 어디에 사는가. 대조 항목의 인용은 재료 원문의 부분 문자열이며(불일치 검출과
-- 같은 태도, R5) ai_evidence_links 의 근거 참조 기계를 쓰지 않는다. 그래서
-- findings_json 안에 함께 산다. questions_json 과 같은 선례다.
-- ============================================================================

-- 초안이 쓴 재료 목록. 주 재료(source_snapshot_id)도 여기에 한 행으로 들어온다.
CREATE TABLE IF NOT EXISTS ai_draft_source_materials (
  id               TEXT PRIMARY KEY,
  draft_version_id TEXT NOT NULL REFERENCES ai_draft_versions (id),
  org_id           TEXT NOT NULL,
  support_case_id  TEXT NOT NULL REFERENCES support_cases (id),
  session_id       TEXT NOT NULL REFERENCES sessions (id),
  -- 전사(녹음 결과 커밋이 있는 스냅샷) | 텍스트 맥락(수기 메모 + 목표 구획).
  kind             TEXT NOT NULL CHECK (kind IN ('transcript', 'text_context')),
  snapshot_id      TEXT NOT NULL REFERENCES ai_masked_source_snapshots (id),
  snapshot_sha256  TEXT NOT NULL
                   CHECK (length(snapshot_sha256) = 64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
  created_at       TEXT NOT NULL,
  -- 종류당 한 재료, 스냅샷당 한 행.
  UNIQUE (draft_version_id, kind),
  UNIQUE (draft_version_id, snapshot_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_draft_source_materials_draft
  ON ai_draft_source_materials (draft_version_id, kind);

-- 재료는 그 초안의 회차·기관·참여 사업에 속한 스냅샷이어야 하고 해시도 맞아야 한다.
CREATE TRIGGER IF NOT EXISTS ai_draft_source_materials_scope_guard
BEFORE INSERT ON ai_draft_source_materials
BEGIN
  SELECT RAISE(ABORT, 'ccc102: draft source material scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_draft_versions AS draft
    JOIN ai_work_items AS work ON work.id = draft.work_item_id
    JOIN ai_masked_source_snapshots AS snapshot
      ON snapshot.id = NEW.snapshot_id
     AND snapshot.org_id = work.org_id
     AND snapshot.support_case_id = work.support_case_id
     AND snapshot.session_id = work.session_id
     AND snapshot.sha256 = NEW.snapshot_sha256
    WHERE draft.id = NEW.draft_version_id
      AND work.org_id = NEW.org_id
      AND work.support_case_id = NEW.support_case_id
      AND work.session_id = NEW.session_id
  );
END;

CREATE TRIGGER IF NOT EXISTS ai_draft_source_materials_no_update
BEFORE UPDATE ON ai_draft_source_materials
BEGIN SELECT RAISE(ABORT, 'ccc102: draft source materials are append-only'); END;

CREATE TRIGGER IF NOT EXISTS ai_draft_source_materials_no_delete
BEFORE DELETE ON ai_draft_source_materials
BEGIN SELECT RAISE(ABORT, 'ccc102: draft source materials are append-only'); END;

-- 대조 3종. 초안 버전당 축 3행이며 축마다 서버가 판정한 상태와 항목 목록을 함께 둔다.
CREATE TABLE IF NOT EXISTS ai_draft_contrast_axes (
  id               TEXT PRIMARY KEY,
  draft_version_id TEXT NOT NULL REFERENCES ai_draft_versions (id),
  org_id           TEXT NOT NULL,
  support_case_id  TEXT NOT NULL REFERENCES support_cases (id),
  -- 메모에 없는 내용(누락) | 음성에 없는 내용(확인 필요) | 미논의 목표.
  axis             TEXT NOT NULL CHECK (axis IN (
                     'missing_from_memo', 'missing_from_transcript', 'undiscussed_session_goal'
                   )),
  -- applied 만 항목을 가진다. 나머지는 "재료 없음" 사유이며 화면이 안내 한 줄로 쓴다.
  status           TEXT NOT NULL CHECK (status IN (
                     'applied', 'no_transcript', 'no_text', 'no_session_goal'
                   )),
  findings_json    TEXT NOT NULL
                   CHECK (json_valid(findings_json) AND json_type(findings_json) = 'array'),
  created_at       TEXT NOT NULL,
  UNIQUE (draft_version_id, axis),
  CHECK (status = 'applied' OR json_array_length(findings_json) = 0)
);

CREATE INDEX IF NOT EXISTS idx_ai_draft_contrast_axes_draft
  ON ai_draft_contrast_axes (draft_version_id, axis);

-- 축 행은 그 초안의 기관·참여 사업에 속하고, 항목은 정해진 네 칸만 가진다.
-- materialKind 는 그 초안이 실제로 쓴 재료 종류여야 한다(없는 재료를 인용할 수 없다).
CREATE TRIGGER IF NOT EXISTS ai_draft_contrast_axes_insert_guard
BEFORE INSERT ON ai_draft_contrast_axes
BEGIN
  SELECT RAISE(ABORT, 'ccc102: contrast axis scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_draft_versions AS draft
    JOIN ai_work_items AS work ON work.id = draft.work_item_id
    WHERE draft.id = NEW.draft_version_id
      AND work.org_id = NEW.org_id
      AND work.support_case_id = NEW.support_case_id
  );

  SELECT RAISE(ABORT, 'ccc102: contrast finding shape is invalid')
  WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.findings_json) AS finding
    WHERE finding.type <> 'object'
       OR NOT (
         json_type(finding.value, '$.description') = 'text'
         AND length(trim(json_extract(finding.value, '$.description'))) > 0
         AND json_type(finding.value, '$.materialKind') = 'text'
         AND json_extract(finding.value, '$.materialKind') IN ('transcript', 'text_context')
         AND json_type(finding.value, '$.sourceRef') = 'text'
         AND length(trim(json_extract(finding.value, '$.sourceRef'))) > 0
         AND json_type(finding.value, '$.quote') = 'text'
         AND length(trim(json_extract(finding.value, '$.quote'))) > 0
         AND (SELECT COUNT(*) FROM json_each(finding.value)) = 4
       )
  );

  SELECT RAISE(ABORT, 'ccc102: contrast finding cites a material the draft did not use')
  WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.findings_json) AS finding
    WHERE NOT EXISTS (
      SELECT 1 FROM ai_draft_source_materials AS material
      WHERE material.draft_version_id = NEW.draft_version_id
        AND material.kind = json_extract(finding.value, '$.materialKind')
        AND material.snapshot_id = json_extract(finding.value, '$.sourceRef')
    )
  );
END;

CREATE TRIGGER IF NOT EXISTS ai_draft_contrast_axes_no_update
BEFORE UPDATE ON ai_draft_contrast_axes
BEGIN SELECT RAISE(ABORT, 'ccc102: contrast axes are append-only'); END;

CREATE TRIGGER IF NOT EXISTS ai_draft_contrast_axes_no_delete
BEFORE DELETE ON ai_draft_contrast_axes
BEGIN SELECT RAISE(ABORT, 'ccc102: contrast axes are append-only'); END;

-- ---------------------------------------------------------------------------
-- 근거 링크 가드 완화. 0033 판의 세 절 중 **가운데 절만** 넓힌다. 첫째 절(초안이
-- grounded 생성분인가)과 셋째 절(이미 종결·추월된 초안인가)은 글자 그대로 되살린다.
-- ---------------------------------------------------------------------------
DROP TRIGGER ai_evidence_links_insert_guard;

CREATE TRIGGER ai_evidence_links_insert_guard
BEFORE INSERT ON ai_evidence_links
BEGIN
  SELECT RAISE(ABORT, 'phase1: evidence links require a generated grounded draft')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_draft_versions AS draft
    WHERE draft.id = NEW.draft_version_id
      AND draft.origin IN ('generated', 'fixture_generated')
      AND draft.grounding_status = 'grounded'
  );
  SELECT RAISE(ABORT, 'phase1: evidence link must match its attested source item')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_draft_versions AS draft
    JOIN ai_work_items AS work ON work.id = draft.work_item_id
    JOIN ai_masked_source_snapshots AS snapshot
      ON snapshot.org_id = work.org_id
     AND snapshot.support_case_id = work.support_case_id
     AND snapshot.session_id = work.session_id
     AND (
       -- 주 재료(단수 컬럼). 레거시 초안은 재료 표에 행이 없으므로 이 길로만 통과한다.
       (snapshot.id = draft.source_snapshot_id AND snapshot.sha256 = draft.source_snapshot_hash)
       -- 이 초안이 실제로 실은 재료(D69 · ADR-0036 재료 다중화).
       OR EXISTS (
         SELECT 1 FROM ai_draft_source_materials AS material
         WHERE material.draft_version_id = draft.id
           AND material.snapshot_id = snapshot.id
           AND material.snapshot_sha256 = snapshot.sha256
       )
     )
    JOIN ai_masked_source_evidence_items AS item
      ON item.id = NEW.source_evidence_item_id AND item.snapshot_id = snapshot.id
     AND item.source_sha256 = snapshot.sha256 AND item.org_id = work.org_id
     AND item.support_case_id = work.support_case_id AND item.session_id = work.session_id
     AND item.source_ref = NEW.source_ref AND item.evidence_quote = NEW.evidence_quote
     AND item.source_start = NEW.source_start AND item.source_end = NEW.source_end
    WHERE draft.id = NEW.draft_version_id
  );
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE EXISTS (SELECT 1 FROM ai_review_events WHERE draft_version_id = NEW.draft_version_id)
     OR EXISTS (
       SELECT 1
       FROM ai_draft_versions AS newer
       JOIN ai_draft_versions AS draft ON draft.id = NEW.draft_version_id
       WHERE newer.work_item_id = draft.work_item_id AND newer.version > draft.version
     );
END;
