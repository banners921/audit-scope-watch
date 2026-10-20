// Risk scores (protocol_risk_scores) have not been recomputed since
// 2026-05-23: compute-risk-scores has no schedule. Frozen scores shown as
// current are worse than no scores, so every surface that reads them checks
// this flag and neither queries nor renders them while it is false.
// Turn it back on once compute-risk-scores runs on a schedule again and the
// "Risk scores" pipeline monitor is unsuppressed and green.
export const RISK_SCORES_LIVE = false;
