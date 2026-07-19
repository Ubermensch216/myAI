// 성명 탐지 — 사전·필드명·문맥·호칭 조합 (FR-311, 기술명세서 Ⅴ-5)

import {
  KOREAN_SURNAMES, KOREAN_SURNAMES_2CHAR, NAME_FIELD_KEYWORDS, NAME_TITLES, NAME_STOPWORDS,
  FIELD_KEYWORDS_BY_TYPE,
} from '../dictionaries.js';

// 모든 유형의 필드명 키워드("차량번호", "전화번호" 등)는 성명 후보에서 제외
const ALL_FIELD_KEYWORDS = new Set(
  Object.values(FIELD_KEYWORDS_BY_TYPE).flat().filter((k) => /^[가-힣]+$/.test(k)),
);
import { makeCandidate } from './helpers.js';

// 필드명 뒤의 값: "성명: 홍길동", "이름 홍길동" (같은 줄 안에서만 — 줄바꿈은 셀·문단 경계)
const FIELD_NAME_PATTERN = new RegExp(
  `(${NAME_FIELD_KEYWORDS.join('|')})[ \\t]*[:：=]?[ \\t]*([가-힣]{2,5})(?![가-힣])`,
  'g',
);

// 이름 뒤에 붙은 조사 제거 ("홍길동에게" → "홍길동")
const TRAILING_PARTICLES = /(에게서|으로부터|께서|에게|한테|으로|은|는|이|가|을|를|의|과|와|께|도|만)$/;
function stripParticles(word) {
  if (word.length <= 2) return word;
  const stripped = word.replace(TRAILING_PARTICLES, '');
  return stripped.length >= 2 ? stripped : word;
}

// 한글 2~5글자 단어 (성씨 사전 확인용)
const HANGUL_WORD = /[가-힣]{2,5}/g;

const TITLE_PATTERN = new RegExp(`^\\s?(${NAME_TITLES.join('|')})(?![가-힣])`);

function startsWithSurname(word) {
  return (
    KOREAN_SURNAMES_2CHAR.has(word.slice(0, 2)) ||
    KOREAN_SURNAMES.has(word[0])
  );
}

export function detectName(text, { otherPiiRanges = [] } = {}) {
  const results = [];
  const seen = new Set();

  // 1) 필드명 기반 탐지 — 높은 신뢰도
  for (const m of text.matchAll(FIELD_NAME_PATTERN)) {
    const word = stripParticles(m[2]);
    if (NAME_STOPWORDS.has(word)) continue;
    if (NAME_FIELD_KEYWORDS.includes(word) || ALL_FIELD_KEYWORDS.has(word)) continue; // 필드명 자체는 성명이 아님
    const start = m.index + m[0].length - m[2].length;
    const end = start + word.length;
    const key = `${start}:${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let score = 0.55 + 0.15;
    if (startsWithSurname(word)) score += 0.2;
    results.push(makeCandidate({ text, start, end, type: 'PERSON_NAME', baseScore: Math.min(score, 1), detectionMethod: 'CONTEXT' }));
  }

  // 동사·어미형 단어 제외 ("연락하여", "안내하고" 등)
  const VERB_SUFFIX = /(하여|하고|하는|하니|하면|하며|했다|한다|합니다|되어|된다|됩니다|하기|하지)$/;

  // 2) 성씨 사전 기반 탐지 — 조사가 붙은 형태("홍길동에게")도 분리하여 인식
  const wordCount = new Map(); // 반복 출현 점수용
  const candidates = [];
  for (const m of text.matchAll(HANGUL_WORD)) {
    const raw = m[0];
    if (raw.length < 2) continue;
    if (VERB_SUFFIX.test(raw)) continue;
    const word = stripParticles(raw);
    if (word.length < 2 || word.length > 4) continue;
    if (!startsWithSurname(word)) continue;
    if (NAME_STOPWORDS.has(word)) continue;
    // 직위·호칭 단어 자체는 성명이 아님 ("주무관" 등)
    if (NAME_TITLES.includes(word)) continue;
    // 필드명 키워드 자체는 성명이 아님 ("차량번호" 등)
    if (ALL_FIELD_KEYWORDS.has(word) || ALL_FIELD_KEYWORDS.has(raw)) continue;
    // 앞이 한글이면 더 긴 단어의 일부이므로 제외
    if (m.index > 0 && /[가-힣]/.test(text[m.index - 1])) continue;
    candidates.push({ word, start: m.index, end: m.index + word.length });
    wordCount.set(word, (wordCount.get(word) || 0) + 1);
  }

  for (const c of candidates) {
    const key = `${c.start}:${c.end}`;
    if (seen.has(key)) continue;

    // 필드명 자체("연락처", "담당자" 등)와 라벨 위치(뒤에 콜론)는 성명이 아님
    if (NAME_FIELD_KEYWORDS.includes(c.word)) continue;
    if (/^\s*[:：=]/.test(text.slice(c.end, c.end + 3))) continue;

    let score = 0.3; // 형식(성씨+2~4글자) 기본 점수
    const after = text.slice(c.end, c.end + 6);

    // 직위·호칭 결합 (홍길동 님, 김철수 과장)
    if (TITLE_PATTERN.test(after)) score += 0.3;

    // 조사 결합 (홍길동은, 홍길동에게 등) — 문장 내 주체로 쓰이는 경우
    if (/^(은|는|이|가|을|를|에게|께서|의)(?![가-힣])/.test(after)) score += 0.1;

    // 다른 개인정보와의 인접성 (전화번호·주민번호 등 40자 이내)
    const nearPii = otherPiiRanges.some(
      (r) => Math.abs(r.start - c.end) < 40 || Math.abs(c.start - r.end) < 40,
    );
    if (nearPii) score += 0.15;

    // 동일 문서 내 반복 출현
    if ((wordCount.get(c.word) || 0) >= 2) score += 0.1;

    // 3글자 이름이 2글자보다 오탐 적음
    if (c.word.length === 2) score -= 0.15;

    if (score < 0.4) continue;
    seen.add(key);
    results.push(makeCandidate({
      text, start: c.start, end: c.end, type: 'PERSON_NAME',
      baseScore: Math.min(score, 1), detectionMethod: 'DICTIONARY',
    }));
  }

  return results;
}
