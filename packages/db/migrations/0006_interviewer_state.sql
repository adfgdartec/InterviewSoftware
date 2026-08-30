-- 0006 · state for the real conversational interviewer (spec §2.2).
--
-- A round now has a variable number of turns, decided live by the interviewer rather than a
-- fixed constant, so it needs somewhere to remember how far up the hint ladder it has gone.
-- No new RLS policy is needed: rounds already carries org_id and is covered by the existing
-- org-isolation policy from migration 0002, which applies to every column on the table.

set search_path = public, loopcraft;

alter table rounds add column current_hint_rung text
  check (current_hint_rung in ('nudge', 'constraint', 'structure', 'partial_solution'));
