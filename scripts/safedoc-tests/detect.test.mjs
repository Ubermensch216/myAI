import { describe, it, expect } from '../safedoc-test-shim.mjs';
import { detectAll, resetIdCounter } from '../../public/modules/safeDoc/detect/engine.js';

function types(candidates) {
  return candidates.map((c) => c.type);
}

describe('탐지엔진 통합', () => {
  it('전화번호·이메일·주민번호를 함께 탐지한다', () => {
    resetIdCounter();
    const text = '민원인 연락처: 010-1234-5678, 이메일: hong@example.com, 주민등록번호 900201-1234567';
    const result = detectAll(text);
    expect(types(result)).toContain('PHONE_MOBILE');
    expect(types(result)).toContain('EMAIL');
    expect(types(result)).toContain('RRN');
  });

  it('필드명 기반 성명을 탐지한다 (FR-311, FR-314)', () => {
    const text = '성명: 홍길동\n연락처: 010-1234-5678';
    const result = detectAll(text);
    const name = result.find((c) => c.type === 'PERSON_NAME');
    expect(name).toBeDefined();
    expect(name.originalText).toBe('홍길동');
  });

  it('주소를 탐지한다 (FR-312)', () => {
    const text = '주소: 부산광역시 중구 중앙대로 100';
    const result = detectAll(text);
    const addr = result.find((c) => c.type === 'ADDRESS');
    expect(addr).toBeDefined();
    expect(addr.originalText).toContain('부산광역시');
  });

  it('동일 위치 중복 탐지를 제거한다 (FR-315)', () => {
    const text = '연락처 010-1234-5678';
    const result = detectAll(text);
    // 같은 구간을 여러 규칙이 잡아도 최종 후보는 겹치지 않아야 함
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i];
        const b = result[j];
        expect(a.start < b.end && b.start < a.end).toBe(false);
      }
    }
  });

  it('사용자 정의 규칙을 적용한다 (FR-803)', () => {
    const text = '사번 EMP-123456 확인';
    const result = detectAll(text, 'body', [{ name: '사번', pattern: 'EMP-\\d{6}', type: 'CUSTOM' }]);
    const custom = result.find((c) => c.detectionMethod === 'USER_RULE');
    expect(custom).toBeDefined();
    expect(custom.originalText).toBe('EMP-123456');
  });

  it('일반 명사는 성명으로 오탐하지 않는다', () => {
    const text = '이상 없음. 주소 정보를 확인하고 전화 연락 바랍니다.';
    const result = detectAll(text);
    const names = result.filter((c) => c.type === 'PERSON_NAME');
    expect(names.length).toBe(0);
  });

  it('차량번호를 탐지한다 (FR-309)', () => {
    const text = '차량번호 12가3456 주차 확인';
    const result = detectAll(text);
    expect(types(result)).toContain('VEHICLE_NO');
  });

  it('생년월일은 필드명이 있을 때 탐지한다 (FR-313)', () => {
    const text = '생년월일: 1990-02-01';
    const result = detectAll(text);
    expect(types(result)).toContain('BIRTH_DATE');
  });
});
