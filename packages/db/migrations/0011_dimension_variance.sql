-- Per-dimension sample spread.
--
-- score_dimensions stored a median and an interval but no variance and no sample count, so
-- loadDebrief substituted the ROUND's variance into every dimension it returned. The debrief
-- then printed "The three samples disagreed. Treat this as weak evidence rather than a
-- measurement." under dimensions where all three samples had in fact agreed exactly -- the
-- warning appeared on nearly every card of a real five-round loop, including cards showing a
-- half-width of 0.3.
--
-- That is the debrief's most trust-sensitive claim, and it was being made from another
-- dimension's numbers. These two columns let each dimension carry its own.
--
-- Nullable on purpose: rows written before this migration genuinely do not have the figure,
-- and inventing one for them would repeat the original mistake in the other direction.
-- loadDebrief falls back to the round-level value for those, and only for those.

alter table score_dimensions
  add column sample_variance numeric(6, 4),
  add column sample_count integer check (sample_count is null or sample_count > 0);

comment on column score_dimensions.sample_variance is
  'Variance of the n=3 grader samples for THIS dimension. Null for rows written before '
  'migration 0011, which fall back to the round-level figure.';
comment on column score_dimensions.sample_count is
  'How many grader samples scored this dimension. Null for pre-0011 rows.';
