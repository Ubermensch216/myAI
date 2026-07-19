// 비식별 처리엔진 — 치환·마스킹·삭제 (기술명세서 Ⅶ)

// 부분 마스킹 규칙 (기술명세서 Ⅶ-1 예시 기반)
export function maskPartial(type, text) {
  switch (type) {
    case 'PERSON_NAME': {
      // 홍길동 → 홍**
      if (text.length <= 1) return '*';
      return text[0] + '*'.repeat(text.length - 1);
    }
    case 'PHONE_MOBILE':
    case 'PHONE_LANDLINE': {
      // 010-1234-5678 → 010-****-5678 (가운데 그룹 마스킹)
      const parts = text.split(/([-.\s()]+)/);
      const digitGroups = parts.filter((p) => /^\d+$/.test(p));
      if (digitGroups.length >= 3) {
        let masked = '';
        let groupIdx = 0;
        for (const p of parts) {
          if (/^\d+$/.test(p)) {
            groupIdx += 1;
            masked += groupIdx === digitGroups.length - 1 ? '*'.repeat(p.length) : p;
          } else {
            masked += p;
          }
        }
        return masked;
      }
      // 구분자가 없으면 가운데 4자리 마스킹
      const mid = Math.floor(text.length / 2);
      return text.slice(0, mid - 2) + '****' + text.slice(mid + 2);
    }
    case 'EMAIL': {
      // example@domain.com → ex*****@domain.com
      const at = text.indexOf('@');
      if (at <= 2) return '*'.repeat(Math.max(at, 1)) + text.slice(at);
      return text.slice(0, 2) + '*'.repeat(at - 2) + text.slice(at);
    }
    case 'RRN':
    case 'FOREIGNER_NO': {
      // 900101-1234567 → 900101-*******
      const sep = text.indexOf('-');
      if (sep > 0) return text.slice(0, sep + 1) + '*'.repeat(text.length - sep - 1);
      return text.slice(0, 6) + '*'.repeat(text.length - 6);
    }
    case 'ACCOUNT_NO':
    case 'CARD_NO': {
      // 뒤 4자리만 남기고 마스킹 (구분자 유지)
      let digitsSeen = 0;
      const totalDigits = text.replace(/\D/g, '').length;
      let out = '';
      for (const ch of text) {
        if (/\d/.test(ch)) {
          digitsSeen += 1;
          out += digitsSeen > totalDigits - 4 ? ch : '*';
        } else {
          out += ch;
        }
      }
      return out;
    }
    default: {
      // 기본: 앞 1/3만 남기고 마스킹
      const keep = Math.max(1, Math.floor(text.length / 3));
      return text.slice(0, keep) + '*'.repeat(text.length - keep);
    }
  }
}

export function maskAll(text, maskChar = '*') {
  // 개인정보 전체를 지정 문자로 변경 (FR-503)
  return maskChar.repeat(Math.max(text.length, 3));
}

export const DELETE_TOKEN = '[삭제]';

// 후보 1건에 대한 최종 치환 문자열 계산
export function computeReplacement(candidate, session) {
  const action = candidate.action || session.typePolicies[candidate.type] || 'REPLACE';
  switch (action) {
    case 'REPLACE':
      return session.getReplacement(candidate.type, candidate.originalText);
    case 'MASK_PART':
      return maskPartial(candidate.type, candidate.originalText);
    case 'MASK_ALL':
      return maskAll(candidate.originalText);
    case 'DELETE':
      return DELETE_TOKEN;
    default:
      return session.getReplacement(candidate.type, candidate.originalText);
  }
}

// 텍스트에 후보 목록 적용 — 문서 뒤쪽부터 앞쪽으로 치환하여 위치 변형 방지 (기술명세서 Ⅶ-4)
// candidates: 동일 documentPart 내 선택된 후보만 전달
export function applyToText(text, candidates, session) {
  const applied = [];
  const sorted = candidates
    .filter((c) => c.selected)
    .slice()
    .sort((a, b) => b.start - a.start);

  let result = text;
  for (const c of sorted) {
    // 중첩 처리 방지 (FR-508): 위치의 원문이 일치하는지 확인
    if (result.slice(c.start, c.end) !== c.originalText) continue;
    const replacement = computeReplacement(c, session);
    result = result.slice(0, c.start) + replacement + result.slice(c.end);
    applied.push({ ...c, replacementText: replacement });
  }
  return { text: result, applied: applied.reverse() };
}
