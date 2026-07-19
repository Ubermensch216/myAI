// 원본 복원 — 비식별 문서 + 대응표 JSON으로 치환값을 원문으로 역치환
// (사용자 결정에 따른 기능; 원 문서 사양에는 없는 확장 기능)

// text 기반 문서(TXT/CSV)의 복원
export function restoreText(text, mappingTable) {
  let restored = text;
  let count = 0;
  const notRestored = [];

  // 긴 치환값부터 처리하여 부분 일치 오류 방지
  const sorted = mappingTable.mappings
    .slice()
    .sort((a, b) => b.replacement.length - a.replacement.length);

  for (const m of sorted) {
    if (!m.reversible) {
      notRestored.push(m);
      continue;
    }
    if (restored.includes(m.replacement)) {
      restored = restored.split(m.replacement).join(m.original);
      count += 1;
    }
  }
  return { text: restored, restoredCount: count, notRestoredCount: notRestored.length };
}
