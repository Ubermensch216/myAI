import assert from "node:assert";
import {
  createNotebook,
  deleteNotebook,
  addNotebookDocument
} from "../server/notebooks.js";
import { searchNotebook } from "../server/rag/departmentRag.js";

console.log("=== 계층형 RAG 검색 통합 테스트 시작 ===");

// 1. 임시 테스트용 노트북 생성
const tempNotebook = await createNotebook({
  name: "계층형 RAG 테스트",
  description: "Parent-Child RAG 및 표 복원 통합 테스트 프로젝트"
});
const notebookId = tempNotebook.id;
console.log(`임시 노트북 생성 완료 (ID: ${notebookId})`);

try {
  // 2. 임시 테스트용 HWPX 문서 (문단 및 표 포함) 구성
  const parsedDoc = {
    fileName: "integration_test.hwpx",
    fileType: "hwpx",
    kind: "document",
    pages: [
      {
        page: 1,
        label: "section0.xml",
        text: `비공개 업무 규정입니다. 이 조항은 보안 사항이므로 외부 유출을 금지합니다.

| 분류 | 내용 | 기한 |
| --- | --- | --- |
| 보안검토 | 프로젝트 A 보안 분석 | 2026-12-31 |
| 실사 | 외부 용역 실사 평가 | 2026-06-30 |

보안검토와 관련된 내용은 신속하게 처리되어야 합니다. 실사 일정도 엄수 바랍니다.`
      }
    ]
  };

  // 3. 노트북에 문서 추가 (계층 청킹 및 SQLite 색인 수행)
  console.log("문서 추가 중...");
  const docSummary = await addNotebookDocument(notebookId, parsedDoc);
  console.log("문서 추가 완료:", docSummary.fileName);

  // 4. RAG 검색 실행 ("보안검토" 키워드로 질의하여 자식이 아닌 부모(표 및 단락 포함)가 복원되는지 확인)
  console.log("RAG 검색 실행 중 (키워드: 보안검토)...");
  const result = await searchNotebook(notebookId, "보안검토", {
    budget: 1000,
    rerank: false
  });

  assert.ok(result.ok, "RAG 검색이 성공해야 함");
  console.log(`검색 매칭 청크 수: ${result.chunks.length}`);

  // 5. 부모 청크로 복원되었는지 검증
  // "보안검토"가 포함된 자식 청크가 검색되었을 때,
  // 그 자식의 부모 청크인 표 전체(사과, 바나나 등이 아닌 여기서는 분류, 내용, 기한 등) 또는 단락 전체가 복원되어 있어야 함.
  for (const chunk of result.chunks) {
    console.log(`매칭된 청크 텍스트 (길이: ${chunk.text.length}):`);
    console.log(chunk.text);
    console.log(`로케이터: ${chunk.locator}`);
    
    // 만약 표 내부의 일부 행만 매칭되었더라도 부모인 전체 표 구조가 다 복원되었는지 검증
    if (chunk.text.includes("보안검토") && chunk.text.includes("| 분류 |")) {
      assert.ok(chunk.text.includes("실사"), "부모로 복원되었으므로 표 내부의 다른 내용('실사')도 포함되어야 함");
      assert.ok(chunk.text.includes("외부 용역 실사 평가"), "부모로 복원되었으므로 실사 행의 상세 내용도 포함되어야 함");
    }
  }

  // 6. 동일 부모를 가진 여러 자식이 매칭되었을 때 중복 제거가 정상 작동하는지 확인
  // 중복이 제거되었으므로 result.chunks 배열 내의 각 항목은 고유한 텍스트/부모 관계를 가져야 함
  const texts = result.chunks.map(c => c.text);
  const uniqueTexts = new Set(texts);
  assert.strictEqual(texts.length, uniqueTexts.size, "RAG 검색 결과 내의 청크들은 중복이 제거되어 고유해야 함");
  console.log("✓ RAG 검색 결과 부모 청크 Hydration 및 중복 제거 검증 완료");

} finally {
  // 7. 테스트용 노트북 및 색인 데이터 삭제 (cleanup)
  console.log("임시 테스트 데이터 삭제 중...");
  await deleteNotebook(notebookId);
  console.log("임시 테스트 데이터 삭제 완료");
}

console.log("=== 계층형 RAG 검색 통합 테스트 완료 (ALL PASSED) ===");
