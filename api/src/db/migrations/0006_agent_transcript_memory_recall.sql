-- Add memory_recall transcript entry kind.
-- The agent loop now emits and persists memory recall events so they can be replayed in history views.

ALTER TABLE "agent_transcript_entries"
DROP CONSTRAINT IF EXISTS "agent_transcript_entries_kind_check";

ALTER TABLE "agent_transcript_entries"
ADD CONSTRAINT "agent_transcript_entries_kind_check"
CHECK (kind IN ('model_request', 'assistant_message', 'tool_message', 'memory_recall', 'loop_stop'));
