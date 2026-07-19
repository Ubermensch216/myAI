import { describe, it, expect } from '../safedoc-test-shim.mjs';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { parseZipDocument, buildZipResult, restoreZipDocument } from '../../public/modules/safeDoc/parsers/xmlDoc.js';
import { detectAll, resetIdCounter } from '../../public/modules/safeDoc/detect/engine.js';
import { applyToText } from '../../public/modules/safeDoc/core/deidentify.js';
import { buildMappingTable } from '../../public/modules/safeDoc/core/mappingTable.js';
import { WorkSession } from '../../public/modules/safeDoc/core/session.js';

// ---------- 픽스처 생성 ----------

function makeXlsx() {
  const workbook = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="민원목록" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets></workbook>`;
  const sharedStrings = `<?xml version="1.0"?><sst count="4" uniqueCount="4"><si><t>성명</t></si><si><t>홍길동</t></si><si><t>전화번호</t></si><si><t>010-1234-5678</t></si></sst>`;
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>`;
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'xl/workbook.xml': strToU8(workbook),
    'xl/sharedStrings.xml': strToU8(sharedStrings),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
    'xl/styles.xml': strToU8('<?xml version="1.0"?><styleSheet/>'),
  }).buffer;
}

function makeDocx() {
  // "홍길동" 이 두 개의 텍스트 런으로 분리된 경우 (기술명세서 Ⅳ-5: 결합 분석)
  const document = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>민원인 홍길</w:t></w:r><w:r><w:t>동, 연락처 010-1234-5678</w:t></w:r></w:p>
<w:p><w:r><w:t>주소: 서울특별시 강남구 테헤란로 152</w:t></w:r></w:p>
</w:body></w:document>`;
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'word/document.xml': strToU8(document),
  }).buffer;
}

function makeHwpx() {
  const section = `<?xml version="1.0"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
<hp:p><hp:run><hp:t>신청인 김철수 (010-9876-5432)</hp:t></hp:run></hp:p>
</hs:sec>`;
  return zipSync({
    mimetype: strToU8('application/hwp+zip'),
    'Contents/section0.xml': strToU8(section),
  }).buffer;
}

function deidentify(parsed) {
  resetIdCounter();
  const session = new WorkSession();
  for (const t of Object.keys(session.typePolicies)) session.typePolicies[t] = 'REPLACE';
  session.candidates = detectAll(parsed.text);
  const { text: afterText, applied } = applyToText(parsed.text, session.candidates, session);
  return { session, afterText, applied };
}

// ---------- XLSX ----------

describe('XLSX 처리 (기술명세서 Ⅳ-4)', () => {
  it('공유 문자열에서 텍스트를 추출하고 시트명을 인식한다', () => {
    const parsed = parseZipDocument(makeXlsx(), 'xlsx');
    expect(parsed.text).toContain('홍길동');
    expect(parsed.text).toContain('010-1234-5678');
    expect(parsed.meta.sheetNames).toBe('민원목록');
  });

  it('치환 후 원문이 제거되고 구조·서식 파일이 보존된다', () => {
    const parsed = parseZipDocument(makeXlsx(), 'xlsx');
    const { applied } = deidentify(parsed);
    expect(applied.length).toBeGreaterThanOrEqual(2);

    const blob = buildZipResult(parsed, applied);
    return blob.arrayBuffer().then((buf) => {
      const out = unzipSync(new Uint8Array(buf));
      const sst = strFromU8(out['xl/sharedStrings.xml']);
      expect(sst).not.toContain('홍길동');
      expect(sst).not.toContain('010-1234-5678');
      expect(sst).toContain('[성명_');
      // 헤더는 유지
      expect(sst).toContain('<t>성명</t>');
      // 시트·스타일 파일은 그대로
      expect(strFromU8(out['xl/worksheets/sheet1.xml'])).toContain('sheetData');
      expect(out['xl/styles.xml']).toBeDefined();
    });
  });

  it('대응표로 복원하면 원문이 되살아난다', () => {
    const parsed = parseZipDocument(makeXlsx(), 'xlsx');
    const { applied } = deidentify(parsed);
    const blob = buildZipResult(parsed, applied);
    const table = buildMappingTable('a.xlsx', 'b.xlsx', applied);

    return blob.arrayBuffer().then((buf) => {
      const deidParsed = parseZipDocument(buf, 'xlsx');
      const { blob: restoredBlob, restoredCount } = restoreZipDocument(deidParsed, table);
      expect(restoredCount).toBeGreaterThanOrEqual(2);
      return restoredBlob.arrayBuffer().then((rbuf) => {
        const out = unzipSync(new Uint8Array(rbuf));
        const sst = strFromU8(out['xl/sharedStrings.xml']);
        expect(sst).toContain('홍길동');
        expect(sst).toContain('010-1234-5678');
      });
    });
  });
});

// ---------- DOCX ----------

describe('DOCX 처리 (기술명세서 Ⅳ-5)', () => {
  it('분리된 텍스트 런을 결합하여 분석한다', () => {
    const parsed = parseZipDocument(makeDocx(), 'docx');
    // "홍길" + "동"이 결합되어 하나의 텍스트로 나타나야 함
    expect(parsed.text).toContain('홍길동');
    const candidates = detectAll(parsed.text);
    expect(candidates.some((c) => c.originalText === '홍길동')).toBe(true);
  });

  it('세그먼트에 걸친 치환이 정상 반영되고 XML 구조가 유지된다', () => {
    const parsed = parseZipDocument(makeDocx(), 'docx');
    const { applied } = deidentify(parsed);

    const blob = buildZipResult(parsed, applied);
    return blob.arrayBuffer().then((buf) => {
      const out = unzipSync(new Uint8Array(buf));
      const doc = strFromU8(out['word/document.xml']);
      expect(doc).not.toContain('홍길');
      expect(doc).not.toContain('010-1234-5678');
      expect(doc).not.toContain('테헤란로 152');
      expect(doc).toContain('[성명_001]');
      // 문단·런 구조 유지
      expect((doc.match(/<w:p>/g) || []).length).toBe(2);
      expect((doc.match(/<w:t>/g) || []).length + (doc.match(/<w:t\s/g) || []).length).toBe(3);
    });
  });
});

// ---------- HWPX ----------

describe('HWPX 처리 (기술명세서 Ⅳ-6)', () => {
  it('본문 텍스트를 추출·치환하고 구조를 유지한다', () => {
    const parsed = parseZipDocument(makeHwpx(), 'hwpx');
    expect(parsed.text).toContain('김철수');
    const { applied } = deidentify(parsed);

    const blob = buildZipResult(parsed, applied);
    return blob.arrayBuffer().then((buf) => {
      const out = unzipSync(new Uint8Array(buf));
      const sec = strFromU8(out['Contents/section0.xml']);
      expect(sec).not.toContain('김철수');
      expect(sec).not.toContain('010-9876-5432');
      expect(sec).toContain('<hp:t>');
      expect(sec).toContain('</hp:p>');
      // mimetype 항목 보존
      expect(strFromU8(out.mimetype)).toBe('application/hwp+zip');
    });
  });
});

// ---------- 보안 ----------

describe('ZIP 보안 검증 (NFR-007)', () => {
  it('ZIP이 아닌 파일은 손상 문서로 거부한다', async () => {
    const notZip = new TextEncoder().encode('평문 텍스트').buffer;
    expect(() => parseZipDocument(notZip, 'xlsx')).toThrow(/E005/);
  });

  it('OLE(암호화 Office) 컨테이너는 암호 문서로 안내한다', () => {
    const ole = new Uint8Array(16);
    ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(() => parseZipDocument(ole.buffer, 'docx')).toThrow(/E004/);
  });

  it('필수 구조가 없는 ZIP은 구조 오류로 거부한다', () => {
    const fake = zipSync({ 'hello.txt': strToU8('내용') }).buffer;
    expect(() => parseZipDocument(fake, 'xlsx')).toThrow(/E009/);
  });
});
