import assert from "node:assert";
import { chunkDocumentSections } from "../server/chunking.js";

console.log("=== 계층형 청커 분할 테스트 시작 ===");

// 샘플 문서 아이템 구성 (페이지 1개에 문단과 표 포함)
const sampleDocument = {
  fileName: "test_doc.hwpx",
  fileType: "hwpx",
  kind: "document",
  pages: [
    {
      page: 1,
      label: "section0.xml",
      text: `첫 번째 단락입니다. 계층형 RAG가 정상적으로 동작하는지 확인하기 위해 샘플 텍스트를 작성하고 있습니다.

두 번째 단락입니다. 부모 청크는 비교적 큰 단위로 형성될 것이며, 자식 청크는 상세한 인덱싱을 위한 작은 단위로 형성됩니다.

| 제품명 | 가격 | 수량 |
| --- | --- | --- |
| 사과 | 1500 | 10 |
| 바나나 | 2000 | 5 |
| 오렌지 | 3000 | 8 |

세 번째 단락입니다. 표가 부모 청크 내에서 분할되지 않고 하나의 완성된 블록으로 묶여 있는지 테스트하고 있습니다. 이 부분도 부모 청크에 잘 들어갈 것입니다.`
    }
  ]
};

// 계층형 청킹 수행
const result = chunkDocumentSections(sampleDocument, {
  hierarchical: true,
  windowChars: 400, // 테스트를 위해 윈도우 크기를 작게 설정
  overlapChars: 100,
  childWindowChars: 100,
  childOverlapChars: 20
});

console.log("청킹 결과:");
console.log(`부모 청크 수: ${result.parentChunks.length}`);
console.log(`자식 청크 수: ${result.chunks.length}`);

// 1. 반환 타입 및 부모/자식 배열 존재 확인
assert.ok(Array.isArray(result.parentChunks));
assert.ok(Array.isArray(result.chunks));

// 2. 부모 청크 내용 확인 (표가 쪼개지지 않고 포함되었는지)
const parentWithTable = result.parentChunks.find(p => p.text.includes("| 제품명 |"));
assert.ok(parentWithTable, "표를 포함한 부모 청크가 존재해야 함");
console.log("표 포함 부모 청크 예시:");
console.log(parentWithTable.text);
// 표 전체 행이 다 들어있는지 확인
assert.ok(parentWithTable.text.includes("사과"));
assert.ok(parentWithTable.text.includes("바나나"));
assert.ok(parentWithTable.text.includes("오렌지"));

// 3. 자식 청크의 parentIndex 검증
for (const child of result.chunks) {
  assert.ok(child.parentIndex !== undefined && child.parentIndex !== null, "자식 청크는 parentIndex를 가져야 함");
  const parent = result.parentChunks[child.parentIndex];
  assert.ok(parent, "parentIndex는 유효한 부모 청크를 가리켜야 함");
  assert.ok(parent.text.includes(child.text.slice(0, 10)), "자식 청크의 텍스트 일부는 부모 청크 내에 포함되어야 함");
}
console.log("✓ 자식 청크와 부모 청크의 매핑 검증 완료");

// 4. 레거시(non-hierarchical) 모드 정상 작동 테스트
const legacyChunks = chunkDocumentSections(sampleDocument, { hierarchical: false });
assert.ok(Array.isArray(legacyChunks));
assert.ok(legacyChunks.length > 0);
assert.ok(legacyChunks[0].parentIndex === undefined, "레거시 청크는 parentIndex를 갖지 않아야 함");
console.log("✓ 레거시 모드 호환성 검증 완료");

console.log("=== 계층형 청커 분할 테스트 완료 (ALL PASSED) ===");
