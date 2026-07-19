// 파일 읽기·검증 (FR-103, NFR-006~008)

import { AppError } from './errors.js';

export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB (NFR-103)

// 지원 형식: 텍스트 PDF는 텍스트 레이어가 있는 문서만 처리한다.
export const SUPPORTED_EXTENSIONS = ['txt', 'csv', 'xlsx', 'docx', 'hwpx', 'pdf'];
export const PLANNED_EXTENSIONS = [];
export const REJECTED_EXTENSIONS = {
  hwp: '구형 HWP 바이너리 문서는 지원하지 않습니다. HWPX로 변환 후 사용해 주십시오.',
  xls: '구형 XLS 문서는 지원하지 않습니다. XLSX로 변환 후 사용해 주십시오.',
  doc: '구형 DOC 문서는 지원하지 않습니다. DOCX로 변환 후 사용해 주십시오.',
  xlsm: '매크로 포함 문서(XLSM)는 지원하지 않습니다.',
  exe: '실행파일은 처리할 수 없습니다.',
  zip: '압축파일은 처리할 수 없습니다.',
  jpg: '이미지 형식 문서는 지원하지 않습니다.',
  jpeg: '이미지 형식 문서는 지원하지 않습니다.',
  png: '이미지 형식 문서는 지원하지 않습니다.',
};

export function getExtension(fileName) {
  const idx = fileName.lastIndexOf('.');
  return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : '';
}

// 파일 검증 후 ArrayBuffer로 읽기
export async function validateAndRead(file) {
  const ext = getExtension(file.name);

  if (REJECTED_EXTENSIONS[ext]) {
    throw new AppError('E001', REJECTED_EXTENSIONS[ext]);
  }
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    if (PLANNED_EXTENSIONS.includes(ext)) {
      throw new AppError('E001', `${ext.toUpperCase()} 형식은 다음 단계에서 지원 예정입니다.`);
    }
    throw new AppError('E001');
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new AppError('E002');
  }
  if (file.size === 0) {
    throw new AppError('E005', '파일 내용이 비어 있습니다.');
  }

  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw new AppError('E003');
  }

  return { name: file.name, size: file.size, ext, buffer };
}

// 결과 파일 다운로드 (FR-603)
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Blob URL 즉시 해제 (기술명세서 Ⅷ-4)
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 결과 파일명 생성 (FR-604): 원본명_비식별.확장자
export function resultFileName(sourceName, suffix = '_비식별') {
  const idx = sourceName.lastIndexOf('.');
  if (idx < 0) return sourceName + suffix;
  return sourceName.slice(0, idx) + suffix + sourceName.slice(idx);
}
