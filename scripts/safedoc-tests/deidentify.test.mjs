import { describe, it, expect } from '../safedoc-test-shim.mjs';
import { maskPartial, maskAll, applyToText } from '../../public/modules/safeDoc/core/deidentify.js';
import { WorkSession } from '../../public/modules/safeDoc/core/session.js';
import { detectAll, resetIdCounter } from '../../public/modules/safeDoc/detect/engine.js';
import { buildMappingTable } from '../../public/modules/safeDoc/core/mappingTable.js';
import { restoreText } from '../../public/modules/safeDoc/core/restore.js';

describe('마스킹 규칙 (기술명세서 Ⅶ-1)', () => {
  it('성명 부분 마스킹: 홍길동 → 홍**', () => {
    expect(maskPartial('PERSON_NAME', '홍길동')).toBe('홍**');
  });
  it('전화번호 부분 마스킹: 가운데 그룹', () => {
    expect(maskPartial('PHONE_MOBILE', '010-1234-5678')).toBe('010-****-5678');
  });
  it('이메일 부분 마스킹', () => {
    expect(maskPartial('EMAIL', 'example@domain.com')).toBe('ex*****@domain.com');
  });
  it('주민번호 부분 마스킹: 뒷자리', () => {
    expect(maskPartial('RRN', '900201-1234567')).toBe('900201-*******');
  });
  it('전체 마스킹', () => {
    expect(maskAll('홍길동')).toBe('***');
  });
});

describe('치환 처리 (FR-501, FR-505)', () => {
  it('동일 세션 내 동일값은 같은 치환값 사용', () => {
    const session = new WorkSession();
    const r1 = session.getReplacement('PERSON_NAME', '홍길동');
    const r2 = session.getReplacement('PERSON_NAME', '홍길동');
    const r3 = session.getReplacement('PERSON_NAME', '김철수');
    expect(r1).toBe('[성명_001]');
    expect(r2).toBe(r1);
    expect(r3).toBe('[성명_002]');
  });

  it('새 세션에서 치환번호 초기화 (FR-507)', () => {
    const session = new WorkSession();
    session.getReplacement('PERSON_NAME', '홍길동');
    session.reset();
    expect(session.getReplacement('PERSON_NAME', '김철수')).toBe('[성명_001]');
  });

  it('텍스트 적용: 뒤→앞 치환으로 위치가 유지된다', () => {
    resetIdCounter();
    const session = new WorkSession();
    const text = '성명: 홍길동, 연락처: 010-1234-5678\n담당자 홍길동에게 전달';
    session.candidates = detectAll(text);
    const { text: after } = applyToText(text, session.candidates, session);
    expect(after).not.toContain('홍길동');
    expect(after).not.toContain('010-1234-5678');
    // 동일값 일관 치환 (FR-505)
    const nameTokens = after.match(/\[성명_\d{3}\]/g) || [];
    expect(new Set(nameTokens).size).toBe(1);
    expect(nameTokens.length).toBe(2);
  });
});

describe('대응표·복원 (사양 변경 기능)', () => {
  it('치환 후 대응표로 원문 복원이 가능하다', () => {
    resetIdCounter();
    const session = new WorkSession();
    // 치환 방식으로 통일 (마스킹은 복원 불가)
    for (const type of Object.keys(session.typePolicies)) session.typePolicies[type] = 'REPLACE';
    const text = '민원인 홍길동 (010-1234-5678) 주소: 서울특별시 강남구 테헤란로 152';
    session.candidates = detectAll(text);
    expect(session.candidates.length).toBeGreaterThan(0);

    const { text: after, applied } = applyToText(text, session.candidates, session);
    const table = buildMappingTable('원본.txt', '원본_비식별.txt', applied);
    expect(table.mappings.length).toBeGreaterThan(0);
    expect(table.mappings.every((m) => m.reversible)).toBe(true);

    const { text: restored } = restoreText(after, table);
    expect(restored).toBe(text);
  });

  it('마스킹 처리 항목은 복원 불가로 표시된다', () => {
    resetIdCounter();
    const session = new WorkSession();
    session.typePolicies.PHONE_MOBILE = 'MASK_PART';
    const text = '연락처: 010-1234-5678';
    session.candidates = detectAll(text);
    const { applied } = applyToText(text, session.candidates, session);
    const table = buildMappingTable('a.txt', 'b.txt', applied);
    const phone = table.mappings.find((m) => m.type === 'PHONE_MOBILE');
    expect(phone.reversible).toBe(false);
  });
});

describe('세션 종료 (FR-705)', () => {
  it('dispose 후 대응정보가 제거된다', () => {
    const session = new WorkSession();
    session.getReplacement('PERSON_NAME', '홍길동');
    session.dispose();
    expect(session.mapping.size).toBe(0);
    expect(session.candidates.length).toBe(0);
  });
});
