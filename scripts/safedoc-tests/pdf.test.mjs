import { describe, it, expect } from '../safedoc-test-shim.mjs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { parsePdf, buildPdfResult } from '../../public/modules/safeDoc/parsers/pdf.js';
import { parseDocument, buildResult, restoreDocument } from '../../public/modules/safeDoc/core/analyzer.js';

async function makeTextPdf(text = 'Contact test@example.com') {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 200]);
  page.drawText(text, { x: 40, y: 120, size: 14, font });
  return (await doc.save()).buffer;
}

describe('PDF 처리', () => {
  it('텍스트 레이어와 페이지 정보를 추출한다', async () => {
    const parsed = await parsePdf(await makeTextPdf(), { render: false });

    expect(parsed.format).toBe('pdf');
    expect(parsed.text).toContain('test@example.com');
    expect(parsed.meta.pageCount).toBe(1);
    expect(parsed.segments.length).toBeGreaterThan(0);
  });

  it('공통 분석 진입점에서 PDF를 비동기로 파싱한다', async () => {
    const buffer = await makeTextPdf();
    const parsed = await parseDocument({ ext: 'pdf', buffer });

    expect(parsed.format).toBe('pdf');
    expect(parsed.text).toContain('test@example.com');
  });

  it('결과 PDF를 생성하고 원문 텍스트를 포함하지 않는다', async () => {
    const parsed = await parsePdf(await makeTextPdf(), { render: false });
    const start = parsed.text.indexOf('test@example.com');
    const applied = [{
      start,
      end: start + 'test@example.com'.length,
      replacementText: '[이메일_001]',
    }];

    const blob = await buildPdfResult(parsed, applied);
    const result = await parsePdf(await blob.arrayBuffer(), { render: false });

    expect(blob.type).toBe('application/pdf');
    expect(result.text).not.toContain('test@example.com');
    expect(result.text).toContain('[이메일_001]');
  });

  it('공통 결과 생성 진입점은 Blob을 반환한다', async () => {
    const parsed = await parsePdf(await makeTextPdf(), { render: false });
    const blob = await buildResult(parsed, parsed.text, []);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
  });

  it('텍스트 레이어가 없는 PDF는 거부한다', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const buffer = (await doc.save()).buffer;

    await expect(parsePdf(buffer, { render: false })).rejects.toThrow(/E006/);
  });

  it('PDF 파일 복원은 명시적으로 거부한다', async () => {
    const parsed = await parsePdf(await makeTextPdf(), { render: false });

    await expect(restoreDocument(parsed, { mappings: [] })).rejects.toThrow(/PDF는 파일 복원을 지원하지 않습니다/);
  });
});
