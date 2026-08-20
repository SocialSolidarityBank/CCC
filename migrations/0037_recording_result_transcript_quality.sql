-- 전사 품질 구조화 필드 (CCC-124).
-- 처리 장비가 반복 붕괴 등 전사 신뢰 불가 판정을 전사 텍스트 안 경고 문장이 아니라
-- 구조화 JSON({"transcriptReliable": bool, "warnings": [{startSeconds, endSeconds, reason}]})
-- 으로 보내면 여기 저장한다. NULL 은 구조화 필드가 없던 레거시 결과다(품질 미상 — 거짓 아님).
-- 경고에는 시간 구간·고정 사유 코드만 담긴다 — 전사 내용은 이 컬럼에 싣지 않는다(R3).
ALTER TABLE recording_result_commits
  ADD COLUMN transcript_quality TEXT
  CHECK (transcript_quality IS NULL
         OR (json_valid(transcript_quality) AND json_type(transcript_quality) = 'object'));

-- 0032 의 불변 트리거를 새 컬럼까지 덮도록 교체한다 — 결과 커밋은 finalization 표시
-- 두 칸(downstream_claimed_at · finalized_at) 말고는 수정 불가라는 계약이 그대로다.
DROP TRIGGER IF EXISTS recording_result_commits_immutable;
CREATE TRIGGER IF NOT EXISTS recording_result_commits_immutable
BEFORE UPDATE ON recording_result_commits
WHEN NEW.session_id IS NOT OLD.session_id
  OR NEW.org_id IS NOT OLD.org_id
  OR NEW.support_case_id IS NOT OLD.support_case_id
  OR NEW.snapshot_id IS NOT OLD.snapshot_id
  OR NEW.result_sha256 IS NOT OLD.result_sha256
  OR NEW.emotion_scores IS NOT OLD.emotion_scores
  OR NEW.transcript_quality IS NOT OLD.transcript_quality
  OR NEW.created_by IS NOT OLD.created_by
  OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.finalized_at IS NOT NULL AND (
    NEW.finalized_at IS NOT OLD.finalized_at
    OR NEW.downstream_claimed_at IS NOT OLD.downstream_claimed_at
  ))
BEGIN
  SELECT RAISE(ABORT, 'recording result commits are immutable except finalization');
END;
