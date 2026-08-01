import { describe, it, expect } from '../safedoc-test-shim.mjs';
import { chunkText } from '../../public/modules/safeDoc/llm/chunker.js';
import { anchorAdditions } from '../../public/modules/safeDoc/llm/anchor.js';
import { applyVerifications, mergeLlmCandidates } from '../../public/modules/safeDoc/llm/merge.js';
import { __test__ as serverLlm } from '../../server/safedocLlm.js';

function makeCandidate(overrides = {}) {
  return {
    id: 'pii-000001',
    documentPart: 'body',
    start: 0,
    end: 3,
    originalText: '홍길동',
    type: 'PERSON_NAME',
    confidence: 0.75,
    detectionMethod: 'CONTEXT',
    context: '',
    selected: true,
    action: null,
    replacementText: null,
    ...overrides,
  };
}

describe('LLM 청크 분할', () => {
  it('짧은 문서는 청크 1개로 반환한다', () => {
    const chunks = chunkText('짧은 문서입니다.', { maxChars: 100 });
    expect(chunks.length).toBe(1);
    expect(chunks[0].start).toBe(0);
  });

  it('긴 문서는 겹침을 두고 분할하며 전체를 빠짐없이 덮는다', () => {
    const text = Array.from({ length: 50 }, (_, i) => `${i}번째 문장입니다.`).join('\n');
    const chunks = chunkText(text, { maxChars: 120, overlap: 20 });
    expect(chunks.length > 1).toBe(true);
    // 각 청크가 이전 청크와 겹치거나 이어져야 함 (빈 구간 없음)
    for (let i = 1; i < chunks.length; i++) {
      const prevEnd = chunks[i - 1].start + chunks[i - 1].text.length;
      expect(chunks[i].start <= prevEnd).toBe(true);
    }
    const last = chunks[chunks.length - 1];
    expect(last.start + last.text.length).toBe(text.length);
  });

  it('줄바꿈 경계에서 자른다', () => {
    const text = `${'가'.repeat(80)}\n${'나'.repeat(80)}`;
    const chunks = chunkText(text, { maxChars: 100, overlap: 0 });
    expect(chunks[0].text.endsWith('\n')).toBe(true);
  });
});

describe('LLM 후보 앵커링', () => {
  it('원문에 없는 값은 환각으로 폐기한다', () => {
    const raw = anchorAdditions('본문에는 다른 내용만 있다.', 0, [
      { value: '김철수', type: 'PERSON_NAME', confidence: 'HIGH' },
    ]);
    expect(raw.length).toBe(0);
  });

  it('다중 출현은 전부 앵커링한다', () => {
    const text = '담당자 김철수, 승인자 김철수';
    const raw = anchorAdditions(text, 100, [
      { value: '김철수', type: 'PERSON_NAME', confidence: 'HIGH' },
    ]);
    expect(raw.length).toBe(2);
    expect(raw[0].start).toBe(104);
    expect(raw[1].start).toBe(113);
    expect(raw[0].detectionMethod).toBe('LLM');
  });

  it('before 힌트가 일치하면 그 출현만 선택한다', () => {
    const text = '담당자 김철수, 승인자 김철수';
    const raw = anchorAdditions(text, 0, [
      { value: '김철수', type: 'PERSON_NAME', before: '승인자 ', confidence: 'HIGH' },
    ]);
    expect(raw.length).toBe(1);
    expect(raw[0].start).toBe(13);
  });

  it('미지 유형은 CUSTOM으로 강등하고 신뢰도를 매핑한다', () => {
    const raw = anchorAdditions('값 ABC123 존재', 0, [
      { value: 'ABC123', type: 'NOT_A_TYPE', confidence: 'LOW' },
      { value: 'ABC123', type: 'PERSON_NAME', confidence: 'HIGH' },
    ]);
    expect(raw[0].type).toBe('CUSTOM');
    expect(raw[0].baseScore).toBe(0.55);
    expect(raw[1].baseScore).toBe(0.85);
  });
});

describe('LLM 검증 반영', () => {
  it('REJECT는 제거가 아니라 신뢰도 강등이다', () => {
    const candidates = [makeCandidate({ confidence: 0.95 })];
    applyVerifications(candidates, [{ id: 'pii-000001', verdict: 'REJECT' }]);
    expect(candidates.length).toBe(1);
    expect(candidates[0].confidence).toBe(0.35);
    expect(candidates[0].llmVerdict).toBe('REJECT');
    expect(candidates[0].selected).toBe(true);
  });

  it('CONFIRM은 신뢰도를 소폭 올린다', () => {
    const candidates = [makeCandidate({ confidence: 0.75 })];
    applyVerifications(candidates, [{ id: 'pii-000001', verdict: 'CONFIRM' }]);
    expect(candidates[0].confidence).toBe(0.8);
    expect(candidates[0].llmVerdict).toBe('CONFIRM');
  });

  it('저신뢰 후보의 RETYPE은 유형을 교체한다', () => {
    const candidates = [makeCandidate({ type: 'CUSTOM', confidence: 0.7, action: 'MASK_ALL' })];
    applyVerifications(candidates, [{ id: 'pii-000001', verdict: 'RETYPE', type: 'ADDRESS' }]);
    expect(candidates[0].type).toBe('ADDRESS');
    expect(candidates[0].action).toBe(null);
  });

  it('체크섬 통과 정형 후보의 RETYPE은 제안으로만 남긴다', () => {
    const candidates = [makeCandidate({
      type: 'RRN', detectionMethod: 'REGEX', confidence: 0.98,
    })];
    applyVerifications(candidates, [{ id: 'pii-000001', verdict: 'RETYPE', type: 'BIRTH_DATE' }]);
    expect(candidates[0].type).toBe('RRN');
    expect(candidates[0].llmSuggestedType).toBe('BIRTH_DATE');
  });

  it('중복 검증(청크 겹침)은 먼저 온 판정을 유지한다', () => {
    const candidates = [makeCandidate({ confidence: 0.75 })];
    applyVerifications(candidates, [
      { id: 'pii-000001', verdict: 'CONFIRM' },
      { id: 'pii-000001', verdict: 'REJECT' },
    ]);
    expect(candidates[0].llmVerdict).toBe('CONFIRM');
  });
});

describe('LLM 후보 병합', () => {
  const text = '성명: 홍길동, 연락처: 010-1234-5678, 담당 김철수';

  it('정규식 후보와 겹치는 LLM 후보는 탈락한다', () => {
    const candidates = [makeCandidate({
      start: 4, end: 7, originalText: '홍길동', confidence: 0.95, detectionMethod: 'REGEX',
    })];
    const llmRaw = [{
      start: 4, end: 7, originalText: '홍길동', type: 'PERSON_NAME',
      baseScore: 0.85, detectionMethod: 'LLM', context: '',
    }];
    const merged = mergeLlmCandidates(candidates, llmRaw, text);
    expect(merged.length).toBe(1);
    expect(merged[0].detectionMethod).toBe('REGEX');
  });

  it('빈 구간의 LLM 후보는 추가되고 id가 재부여된다', () => {
    const candidates = [makeCandidate({ start: 4, end: 7, originalText: '홍길동' })];
    const llmRaw = [{
      start: 26, end: 29, originalText: '김철수', type: 'PERSON_NAME',
      baseScore: 0.85, detectionMethod: 'LLM', context: '',
    }];
    const merged = mergeLlmCandidates(candidates, llmRaw, text);
    expect(merged.length).toBe(2);
    expect(merged.every((c) => /^pii-\d{6}$/.test(c.id))).toBe(true);
    expect(merged.find((c) => c.detectionMethod === 'LLM')).toBeDefined();
  });

  it('겹침 구간의 동일 LLM 후보 중복은 하나만 남는다', () => {
    const dup = {
      start: 26, end: 29, originalText: '김철수', type: 'PERSON_NAME',
      baseScore: 0.85, detectionMethod: 'LLM', context: '',
    };
    const merged = mergeLlmCandidates([], [dup, { ...dup }], text);
    expect(merged.length).toBe(1);
  });

  it('검증 부가 필드(llmVerdict)가 병합 후에도 유지된다', () => {
    const candidates = [makeCandidate({ start: 4, end: 7, llmVerdict: 'REJECT', confidence: 0.35 })];
    const llmRaw = [{
      start: 26, end: 29, originalText: '김철수', type: 'PERSON_NAME',
      baseScore: 0.85, detectionMethod: 'LLM', context: '',
    }];
    const merged = mergeLlmCandidates(candidates, llmRaw, text);
    const kept = merged.find((c) => c.originalText === '홍길동');
    expect(kept.llmVerdict).toBe('REJECT');
  });
});

describe('서버 응답 정규화 (safedocLlm)', () => {
  const request = {
    text: '성명: 홍길동, 연락처: 010-1234-5678',
    candidates: [{ id: 'pii-000001', type: 'PERSON_NAME', text: '홍길동', context: '' }],
  };

  it('미지 id·부정 verdict·미지 유형을 거른다', () => {
    const out = serverLlm.normalizeResponse({
      verifications: [
        { id: 'pii-000001', verdict: 'CONFIRM' },
        { id: 'pii-999999', verdict: 'REJECT' },
        { id: 'pii-000001', verdict: 'DESTROY' },
      ],
      additions: [
        { value: '010-1234-5678', type: 'PHONE_MOBILE', confidence: 'HIGH' },
        { value: '문서에 없는 값', type: 'PERSON_NAME', confidence: 'HIGH' },
        { value: '홍길동', type: 'PERSON_NAME', confidence: 'HIGH' },
      ],
    }, request);
    expect(out.verifications.length).toBe(1);
    expect(out.additions.length).toBe(1);
    expect(out.additions[0].value).toBe('010-1234-5678');
  });

  it('RETYPE에 유효한 type이 없으면 버린다', () => {
    const out = serverLlm.normalizeResponse({
      verifications: [{ id: 'pii-000001', verdict: 'RETYPE', type: 'NOT_A_TYPE' }],
      additions: [],
    }, request);
    expect(out.verifications.length).toBe(0);
  });

  it('요청 정규화가 빈 텍스트를 거부한다', () => {
    let threw = false;
    try {
      serverLlm.normalizeRequest({ text: '   ' });
    } catch (err) {
      threw = err.statusCode === 400;
    }
    expect(threw).toBe(true);
  });
});
