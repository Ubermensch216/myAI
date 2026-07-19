// 처리결과 요약 (FR-606, FR-607, 기술명세서 Ⅸ-2·3)
// 요약에는 개인정보 원문을 포함하지 않는다.

import { PROGRAM_VERSION } from '../version.js';
import { RULE_VERSION } from '../detect/engine.js';
import { PII_TYPES, ACTION_LABELS } from '../detect/types.js';

export function buildSummary({ session, applied, startedAt, finishedAt, resultName }) {
  const typeCounts = {};
  const actionCounts = {};
  for (const c of applied) {
    typeCounts[c.type] = (typeCounts[c.type] || 0) + 1;
    const action = c.action || session.typePolicies[c.type] || 'REPLACE';
    actionCounts[action] = (actionCounts[action] || 0) + 1;
  }

  return {
    sourceFileName: session.file?.name || '',
    resultFileName: resultName,
    processedAt: finishedAt.toISOString(),
    processingStartedAt: startedAt.toISOString(),
    programVersion: PROGRAM_VERSION,
    ruleVersion: RULE_VERSION,
    detectedCount: session.candidates.length,
    processedCount: applied.length,
    excludedCount: session.excludedCount,
    manuallyAddedCount: session.manuallyAddedCount,
    unprocessedCount: session.candidates.filter((c) => !c.selected).length - session.excludedCount,
    typeCounts,
    actionCounts,
  };
}

export function summaryToBlob(summary) {
  return new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
}

export function typeLabel(code) {
  return PII_TYPES[code]?.label || code;
}

export function actionLabel(code) {
  return ACTION_LABELS[code] || code;
}
