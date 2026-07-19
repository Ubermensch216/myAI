// 개인정보 형식 유효성 검증 모듈 (기술명세서 Ⅴ-4)

// 주민등록번호: 앞 6자리 날짜 + 뒷자리 첫 숫자 범위 + 검증번호
export function validateRRN(digits13) {
  if (!/^\d{13}$/.test(digits13)) return { valid: false, score: 0 };
  const yy = Number(digits13.slice(0, 2));
  const mm = Number(digits13.slice(2, 4));
  const dd = Number(digits13.slice(4, 6));
  const genderDigit = Number(digits13[6]);

  if (mm < 1 || mm > 12) return { valid: false, score: 0 };
  if (dd < 1 || dd > 31) return { valid: false, score: 0 };
  // 내국인: 1,2(1900년대), 3,4(2000년대), 9,0(1800년대)
  if (![1, 2, 3, 4, 9, 0].includes(genderDigit)) return { valid: false, score: 0 };

  const century = genderDigit <= 2 ? 1900 : genderDigit <= 4 ? 2000 : 1800;
  const date = new Date(century + yy, mm - 1, dd);
  if (date.getMonth() !== mm - 1 || date.getDate() !== dd) return { valid: false, score: 0 };

  // 검증번호 (2020년 10월 이후 발급분은 임의번호이므로 실패해도 후보 유지, 점수만 차등)
  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits13[i]) * weights[i];
  const check = (11 - (sum % 11)) % 10;
  const checksumOk = check === Number(digits13[12]);
  return { valid: true, score: checksumOk ? 1.0 : 0.75, checksumOk };
}

// 외국인등록번호: 날짜 유효 + 뒷자리 첫 숫자 5~8
export function validateForeignerNo(digits13) {
  if (!/^\d{13}$/.test(digits13)) return { valid: false, score: 0 };
  const mm = Number(digits13.slice(2, 4));
  const dd = Number(digits13.slice(4, 6));
  const genderDigit = Number(digits13[6]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return { valid: false, score: 0 };
  if (![5, 6, 7, 8].includes(genderDigit)) return { valid: false, score: 0 };
  return { valid: true, score: 0.95 };
}

// 카드번호 Luhn 검증
export function validateLuhn(digits) {
  if (!/^\d{13,19}$/.test(digits)) return { valid: false, score: 0 };
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  const ok = sum % 10 === 0;
  // Luhn 실패 시 낮은 신뢰도 후보로 유지 (기술명세서 Ⅴ-4)
  return { valid: true, score: ok ? 1.0 : 0.4, checksumOk: ok };
}

// 사업자등록번호 검증번호
export function validateBusinessNo(digits10) {
  if (!/^\d{10}$/.test(digits10)) return { valid: false, score: 0 };
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits10[i]) * weights[i];
  sum += Math.floor((Number(digits10[8]) * 5) / 10);
  const check = (10 - (sum % 10)) % 10;
  const ok = check === Number(digits10[9]);
  return { valid: ok, score: ok ? 1.0 : 0 };
}

// 생년월일 날짜 유효성
export function validateDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

// IPv4 각 옥텟 범위
export function validateIPv4(text) {
  const parts = text.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}
