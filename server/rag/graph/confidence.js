const RELATION_TYPE_PRIOR = Object.freeze({
  BASED_ON: 0.06,
  REQUIRES: 0.05,
  PART_OF: 0.04,
  OWNED_BY: 0.03,
  CONTRASTS_WITH: 0.01,
  RELATES_TO: -0.04
});

function clamp01(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function evidenceAdjustment(evidence, chunkText) {
  const quote = normalizeText(evidence);
  if (!quote) return { delta: -0.18, hasEvidence: false, evidenceMatches: false };

  const len = quote.length;
  let delta = len >= 30 ? 0.07 : len >= 12 ? 0.04 : -0.03;
  const haystack = normalizeText(chunkText);
  const evidenceMatches = haystack.includes(quote);
  delta += evidenceMatches ? 0.06 : -0.04;
  return { delta, hasEvidence: true, evidenceMatches };
}

function supportBoost(supportBefore) {
  const count = Math.max(0, Number(supportBefore) || 0);
  if (count <= 0) return 0;
  return Math.min(0.18, Math.log1p(count) * 0.08);
}

export function makeEntitySupportKey(entity) {
  return `${entity?.type || ""}|${normalizeText(entity?.label)}`;
}

export function scoreEntityConfidence(entity, chunkText, supportBefore = 0) {
  const selfRaw = clamp01(entity?.confidence) ?? 0.74;
  const self = 0.55 + selfRaw * 0.35;
  const evidence = evidenceAdjustment(entity?.evidence, chunkText);
  let score = self + evidence.delta + supportBoost(supportBefore);
  if (!evidence.hasEvidence) score = Math.min(score, 0.58);
  return Math.max(0.05, Math.min(1, score));
}

export function scoreRelationConfidence(relation, chunkText, supportBefore = 0) {
  const selfRaw = clamp01(relation?.confidence) ?? 0.7;
  const self = 0.52 + selfRaw * 0.34;
  const evidence = evidenceAdjustment(relation?.evidence, chunkText);
  const prior = RELATION_TYPE_PRIOR[relation?.type] ?? 0;
  let score = self + evidence.delta + prior + supportBoost(supportBefore);
  if (!evidence.hasEvidence) score = Math.min(score, 0.56);
  return Math.max(0.05, Math.min(1, score));
}
