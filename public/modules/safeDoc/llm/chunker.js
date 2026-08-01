// LLM 분석용 청크 분할 — 순수 함수
//
// 문서 전체를 한 번에 보낼 수 없으므로 문장·문단 경계에서 자른다.
// 청크 경계에 걸린 개인정보(전화번호 등)가 잘리지 않도록 앞 청크 끝을
// overlap 만큼 다음 청크에 겹쳐 넣는다. 겹침 구간에서 이중 탐지된 후보는
// 병합 단계의 resolveOverlaps 가 제거한다.

const BREAK_CHARS = ['\n', '。', '.', '!', '?', ';'];

export function chunkText(text, { maxChars = 6000, overlap = 200 } = {}) {
  if (typeof text !== 'string' || text.length === 0) return [];
  if (text.length <= maxChars) return [{ start: 0, text }];

  const chunks = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(pos + maxChars, text.length);
    if (end < text.length) {
      end = pos + findBreak(text.slice(pos, end));
    }
    chunks.push({ start: pos, text: text.slice(pos, end) });
    if (end >= text.length) break;
    pos = Math.max(end - overlap, pos + 1);
  }
  return chunks;
}

// 청크 창 안에서 자를 위치를 고른다: 창 후반부의 마지막 줄바꿈 → 마지막
// 문장부호 → 강제 절단. 너무 앞에서 자르면 청크가 잘게 쪼개지므로
// 창의 절반 이전 위치는 쓰지 않는다.
function findBreak(window) {
  const minBreak = Math.floor(window.length / 2);
  const nl = window.lastIndexOf('\n');
  if (nl >= minBreak) return nl + 1;
  for (let i = window.length - 1; i >= minBreak; i--) {
    if (BREAK_CHARS.includes(window[i])) return i + 1;
  }
  return window.length;
}
