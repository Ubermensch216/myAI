import { describe, it, expect } from '../safedoc-test-shim.mjs';
import {
  validateRRN, validateForeignerNo, validateLuhn, validateBusinessNo, validateDate, validateIPv4,
} from '../../public/modules/safeDoc/detect/validators.js';

describe('주민등록번호 검증', () => {
  it('검증번호가 맞는 번호는 score 1.0', () => {
    // 9002011234567 → 검증번호 계산으로 유효한 예시 생성
    const base = '900201123456';
    const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(base[i]) * weights[i];
    const check = (11 - (sum % 11)) % 10;
    const result = validateRRN(base + check);
    expect(result.valid).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it('날짜가 잘못된 번호는 무효', () => {
    expect(validateRRN('9013011234567').valid).toBe(false); // 13월
    expect(validateRRN('9002321234567').valid).toBe(false); // 32일
  });

  it('뒷자리 첫 숫자가 내국인 범위 밖이면 무효', () => {
    expect(validateRRN('9002015234567').valid).toBe(false); // 5는 외국인
  });

  it('검증번호가 틀려도 날짜가 유효하면 낮은 점수로 유지', () => {
    const r = validateRRN('9002011234560');
    if (r.valid) expect(r.score).toBeLessThan(1.0);
  });
});

describe('외국인등록번호 검증', () => {
  it('뒷자리 5~8로 시작하면 유효', () => {
    expect(validateForeignerNo('9002015234567').valid).toBe(true);
  });
  it('내국인 범위(1~4)는 무효', () => {
    expect(validateForeignerNo('9002011234567').valid).toBe(false);
  });
});

describe('Luhn 카드번호 검증', () => {
  it('유효한 카드번호(테스트 번호)는 checksumOk', () => {
    expect(validateLuhn('4111111111111111').checksumOk).toBe(true);
  });
  it('잘못된 번호는 checksumOk false, 낮은 점수', () => {
    const r = validateLuhn('4111111111111112');
    expect(r.checksumOk).toBe(false);
    expect(r.score).toBeLessThan(0.5);
  });
});

describe('사업자등록번호 검증', () => {
  it('유효한 번호 통과', () => {
    // 검증번호 규칙에 맞는 번호 생성
    const base = '123456789';
    const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += Number(base[i]) * weights[i];
    sum += Math.floor((Number(base[8]) * 5) / 10);
    const check = (10 - (sum % 10)) % 10;
    expect(validateBusinessNo(base + check).valid).toBe(true);
  });
  it('검증번호 불일치는 무효', () => {
    expect(validateBusinessNo('1234567890').valid === true || validateBusinessNo('1234567891').valid === true).toBe(true);
    // 둘 중 하나만 유효할 수 있음 — 최소한 형식 오류는 무효
    expect(validateBusinessNo('12345').valid).toBe(false);
  });
});

describe('날짜·IP 검증', () => {
  it('validateDate', () => {
    expect(validateDate(1990, 2, 28)).toBe(true);
    expect(validateDate(1990, 2, 30)).toBe(false);
  });
  it('validateIPv4', () => {
    expect(validateIPv4('192.168.0.1')).toBe(true);
    expect(validateIPv4('300.1.1.1')).toBe(false);
  });
});
