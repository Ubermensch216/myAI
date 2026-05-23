import assert from "node:assert";
import { parseHwpxSectionXml } from "../server/parsers.js";

console.log("=== HWPX 파서 및 표 구조 분석 테스트 시작 ===");

// 1. 일반 문단 파싱 테스트
const xmlParagraphs = `
<?xml version="1.0" encoding="utf-8"?>
<hp:section xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p>
    <hp:run>
      <hp:t>안녕하세요, 첫 번째 문단입니다.</hp:t>
    </hp:run>
  </hp:p>
  <hp:p>
    <hp:run>
      <hp:t>반갑습니다, 두 번째 문단입니다.</hp:t>
    </hp:run>
  </hp:p>
</hp:section>
`;

const textParsed = parseHwpxSectionXml(xmlParagraphs);
console.log("일반 문단 파싱 결과:");
console.log(JSON.stringify(textParsed));
assert.ok(textParsed.includes("안녕하세요, 첫 번째 문단입니다."));
assert.ok(textParsed.includes("반갑습니다, 두 번째 문단입니다."));
assert.ok(textParsed.includes("\n\n")); // 문단 구분 개행 확인
console.log("✓ 일반 문단 파싱 검증 완료");

// 2. 표 파싱 테스트 (마크다운 표 변환)
const xmlTable = `
<?xml version="1.0" encoding="utf-8"?>
<hp:section xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:tbl>
    <hp:tr>
      <hp:tc>
        <hp:p><hp:run><hp:t>이름</hp:t></hp:run></hp:p>
      </hp:tc>
      <hp:tc>
        <hp:p><hp:run><hp:t>부서</hp:t></hp:run></hp:p>
      </hp:tc>
      <hp:tc>
        <hp:p><hp:run><hp:t>역할</hp:t></hp:run></hp:p>
      </hp:tc>
    </hp:tr>
    <hp:tr>
      <hp:tc>
        <hp:p><hp:run><hp:t>김철수</hp:t></hp:run></hp:p>
      </hp:tc>
      <hp:tc>
        <hp:p><hp:run><hp:t>인사팀</hp:t></hp:run></hp:p>
      </hp:tc>
      <hp:tc>
        <hp:p><hp:run><hp:t>팀장</hp:t></hp:run></hp:p>
      </hp:tc>
    </hp:tr>
    <hp:tr>
      <hp:tc>
        <hp:p><hp:run><hp:t>이영희</hp:t></hp:run></hp:p>
      </hp:tc>
      <hp:tc>
        <hp:p><hp:run><hp:t>개발팀</hp:t></hp:run></hp:p>
      </hp:tc>
      <hp:tc>
        <hp:p><hp:run><hp:t>수석</hp:t></hp:run></hp:p>
      </hp:tc>
    </hp:tr>
  </hp:tbl>
</hp:section>
`;

const tableParsed = parseHwpxSectionXml(xmlTable);
console.log("표 파싱 결과:");
console.log(tableParsed);

assert.ok(tableParsed.includes("| 이름 | 부서 | 역할 |"));
assert.ok(tableParsed.includes("| --- | --- | --- |"));
assert.ok(tableParsed.includes("| 김철수 | 인사팀 | 팀장 |"));
assert.ok(tableParsed.includes("| 이영희 | 개발팀 | 수석 |"));
console.log("✓ 표 구조 마크다운 변환 검증 완료");

// 3. 예외 상황 처리 및 fallback 검증
const xmlMalformed = `
<hp:section>
  <hp:p><hp:t>정상 텍스트</hp:t></hp:p>
  <hp:broken-tag>깨진 태그 발생
`;

// 에러 로그가 노출되어도 fallback이 정상 수행되어 일부 텍스트라도 건지는지 검증
const fallbackParsed = parseHwpxSectionXml(xmlMalformed);
console.log("예외 상황 파싱 결과:", JSON.stringify(fallbackParsed));
assert.ok(fallbackParsed.includes("정상 텍스트"));
console.log("✓ 예외 상황 및 fallback 동작 검증 완료");

console.log("=== HWPX 파서 및 표 구조 분석 테스트 완료 (ALL PASSED) ===");
