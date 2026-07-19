import { describe, it, expect } from '../safedoc-test-shim.mjs';
import { detectDelimiter, tokenizeCsv, inferColumnTypes, parseCsv, columnCandidates } from '../../public/modules/safeDoc/parsers/csv.js';

function toBuffer(text) {
  return new TextEncoder().encode(text).buffer;
}

describe('CSV 파서', () => {
  it('구분자를 판별한다', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('a;b;c')).toBe(';');
  });

  it('셀 위치를 정확히 기록한다', () => {
    const text = '성명,전화번호\n홍길동,010-1234-5678';
    const rows = tokenizeCsv(text, ',');
    expect(rows.length).toBe(2);
    const cell = rows[1][0];
    expect(text.slice(cell.start, cell.end)).toBe('홍길동');
  });

  it('따옴표 셀과 셀 내 줄바꿈을 처리한다', () => {
    const text = 'a,"줄1\n줄2",c';
    const rows = tokenizeCsv(text, ',');
    expect(rows.length).toBe(1);
    expect(rows[0][1].value).toBe('줄1\n줄2');
    expect(rows[0][2].value).toBe('c');
  });

  it('헤더명으로 열 유형을 추정한다 (기술명세서 Ⅳ-3)', () => {
    const text = '성명,전화번호,주소\n홍길동,010-1234-5678,서울';
    const rows = tokenizeCsv(text, ',');
    const hints = inferColumnTypes(rows[0]);
    expect(hints[0]).toBe('PERSON_NAME');
    expect(hints[2]).toBe('ADDRESS');
  });

  it('열 힌트 기반 후보를 생성한다', () => {
    const parsed = parseCsv(toBuffer('성명,비고\n홍길동,메모입니다'));
    const cands = columnCandidates(parsed);
    const name = cands.find((c) => c.type === 'PERSON_NAME');
    expect(name).toBeDefined();
    expect(parsed.text.slice(name.start, name.end)).toBe('홍길동');
  });

  it('EUC-KR 인코딩을 판별한다', () => {
    // '홍길동'을 CP949 바이트로 표현
    const cp949 = new Uint8Array([0xc8, 0xab, 0xb1, 0xe6, 0xb5, 0xbf]);
    const parsed = parseCsv(cp949.buffer);
    expect(parsed.encoding).toBe('euc-kr');
    expect(parsed.text).toBe('홍길동');
  });
});
