-- 녹음 결과 커밋의 멱등 키와 완료 경계 (CCC-96).
-- 마스킹 본문은 ai_masked_source_snapshots 한 곳에만 두고 여기에는 연결 정보와
-- 숫자형 처리 메타데이터만 둔다. 세션당 1행이라 응답 유실 뒤 재전송도 새 결과를 만들지 않는다.
CREATE TABLE IF NOT EXISTS recording_result_commits (
  session_id       TEXT PRIMARY KEY REFERENCES sessions (id),
  org_id           TEXT NOT NULL,
  support_case_id  TEXT NOT NULL REFERENCES support_cases (id),
  snapshot_id      TEXT NOT NULL REFERENCES ai_masked_source_snapshots (id),
  result_sha256    TEXT NOT NULL CHECK (length(result_sha256) = 64 AND result_sha256 NOT GLOB '*[^0-9a-f]*'),
  emotion_scores   TEXT NOT NULL CHECK (json_valid(emotion_scores) AND json_type(emotion_scores) = 'object'),
  created_by       TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  downstream_claimed_at TEXT,
  finalized_at     TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recording_result_commits_snapshot
  ON recording_result_commits (snapshot_id);

CREATE TRIGGER IF NOT EXISTS recording_result_commits_scope_guard
BEFORE INSERT ON recording_result_commits
BEGIN
  SELECT RAISE(ABORT, 'recording result scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM sessions AS session
    JOIN ai_masked_source_snapshots AS snapshot
      ON snapshot.id = NEW.snapshot_id
     AND snapshot.session_id = session.id
     AND snapshot.org_id = session.org_id
     AND snapshot.support_case_id = session.support_case_id
    WHERE session.id = NEW.session_id
      AND session.org_id = NEW.org_id
      AND session.support_case_id = NEW.support_case_id
  );
END;

CREATE TRIGGER IF NOT EXISTS recording_result_commits_immutable
BEFORE UPDATE ON recording_result_commits
WHEN NEW.session_id IS NOT OLD.session_id
  OR NEW.org_id IS NOT OLD.org_id
  OR NEW.support_case_id IS NOT OLD.support_case_id
  OR NEW.snapshot_id IS NOT OLD.snapshot_id
  OR NEW.result_sha256 IS NOT OLD.result_sha256
  OR NEW.emotion_scores IS NOT OLD.emotion_scores
  OR NEW.created_by IS NOT OLD.created_by
  OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.finalized_at IS NOT NULL AND (
    NEW.finalized_at IS NOT OLD.finalized_at
    OR NEW.downstream_claimed_at IS NOT OLD.downstream_claimed_at
  ))
BEGIN
  SELECT RAISE(ABORT, 'recording result commits are immutable except finalization');
END;

CREATE TRIGGER IF NOT EXISTS recording_result_commits_no_delete
BEFORE DELETE ON recording_result_commits
BEGIN
  SELECT RAISE(ABORT, 'recording result commits are append-only');
END;
