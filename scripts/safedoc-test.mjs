#!/usr/bin/env node
/**
 * 문서보안(safeDoc) 모듈 시험 러너.
 *
 * safeDoc에서 이식한 단위 시험 6개 파일(scripts/safedoc-tests/)과, 통합 과정에서
 * 새로 필요해진 검증 3가지를 함께 실행한다.
 *
 * Usage: node scripts/safedoc-test.mjs   (= npm run test:safedoc)
 */
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptsDir, '..');
const moduleDir = path.join(rootDir, 'public', 'modules', 'safeDoc');

// ---------- 통합 검증 (시험 파일 실행 전 정적 검사) ----------

function walkJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walkJs(full);
    return e.name.endsWith('.js') ? [full] : [];
  });
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// 검증 1: 외부 통신·평문 저장 금지 (원본 safeDoc은 CSP connect-src 'none' 으로
// 강제했으나 myAI에는 CSP가 없으므로 정적 검사로 대체한다)
//
// 예외: llm/api.js 한 파일만 fetch 를 쓸 수 있다 — 로컬 서버의 safeDoc LLM
// 분석 API(/api/safedoc/) 상대경로 호출 전용이며, 절대 URL(외부 호스트)이
// 등장하면 위반으로 본다.
const LLM_API_FILE = path.join('llm', 'api.js');

function assertNoNetworkOrPlainStorage() {
  const forbidden = [
    { pattern: /\bfetch\s*\(/, label: 'fetch(' },
    { pattern: /XMLHttpRequest/, label: 'XMLHttpRequest' },
    { pattern: /sendBeacon/, label: 'navigator.sendBeacon' },
    { pattern: /\blocalStorage\b/, label: 'localStorage' },
    { pattern: /\bsessionStorage\b/, label: 'sessionStorage' },
    { pattern: /new\s+WebSocket/, label: 'WebSocket' }
  ];
  const violations = [];
  for (const file of walkJs(moduleDir)) {
    // 주석에서 이 이름들을 언급하는 것은 위반이 아니므로(무엇을 왜 쓰지 않는지
    // 설명하는 주석이 실제로 있다) 검사 전에 주석을 제거한다.
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    const isLlmApi = path.relative(moduleDir, file) === LLM_API_FILE;
    for (const { pattern, label } of forbidden) {
      if (isLlmApi && label === 'fetch(') continue;
      if (pattern.test(source)) {
        violations.push(`${path.relative(rootDir, file)} → ${label}`);
      }
    }
    if (isLlmApi) {
      if (!source.includes("'/api/safedoc/")) {
        violations.push(`${path.relative(rootDir, file)} → llm/api.js 는 /api/safedoc/ 상대경로만 호출해야 합니다`);
      }
      if (/https?:\/\//.test(source)) {
        violations.push(`${path.relative(rootDir, file)} → llm/api.js 에 절대 URL이 있습니다 (외부 전송 금지)`);
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(
      '문서보안 모듈은 외부 전송과 평문 저장을 해서는 안 됩니다:\n  ' + violations.join('\n  ')
    );
  }
  console.log('  [1/3] 외부 통신·평문 저장 없음 (llm/api.js 는 로컬 API 한정)');
}

// 검증 2: 개인정보를 담은 WorkSession 이 영속화 경로에 닿지 않아야 한다.
// 실제 저장은 persistence.js 가 state 객체만 직렬화하므로, safeDoc이 state에
// 심는 값에 민감 키가 없는지 확인한다.
async function assertSessionNotPersisted() {
  const { WorkSession } = await import('../public/modules/safeDoc/core/session.js');
  const session = new WorkSession();
  const sensitiveKeys = ['parsed', 'mapping', 'candidates', 'buffer', 'file', 'result', 'userRules'];

  // safeDoc이 영속화하는 것은 유형별 처리방식 정책뿐이다.
  const { serializeSafeDocState } = await import('../public/modules/safeDoc/policies.js');
  const persisted = JSON.parse(JSON.stringify(serializeSafeDocState({
    typePolicies: { RRN: 'MASK_ALL' },
    userRules: [{ name: '사번', pattern: '\\d{6}' }]
  })));

  const found = sensitiveKeys.filter((k) => k in persisted);
  if (found.length > 0) {
    throw new Error(`영속화 대상에 민감 키가 포함되었습니다: ${found.join(', ')}`);
  }
  if ('userRules' in persisted) {
    throw new Error('사용자 정의 규칙(정규식)은 영속화하지 않아야 합니다.');
  }
  if (typeof session.dispose !== 'function') {
    throw new Error('WorkSession.dispose()가 없습니다 — 화면 이탈 시 메모리 정리가 불가합니다.');
  }
  console.log('  [2/3] WorkSession 비영속 가드');
}

// 검증 3: 저장된 정책을 신뢰하지 않고 화이트리스트로 정규화하는지
async function assertPolicyNormalization() {
  const { normalizeTypePolicies } = await import('../public/modules/safeDoc/policies.js');

  const cleaned = normalizeTypePolicies({
    RRN: 'MASK_ALL',
    __proto__: 'DELETE',
    NOT_A_REAL_TYPE: 'REPLACE',
    EMAIL: 'DROP_TABLE',
    PHONE_MOBILE: 12345
  });

  if (cleaned.RRN !== 'MASK_ALL') throw new Error('유효한 정책이 보존되지 않았습니다.');
  if ('NOT_A_REAL_TYPE' in cleaned) throw new Error('미지의 유형 키가 통과했습니다.');
  if (cleaned.EMAIL === 'DROP_TABLE') throw new Error('부정한 처리방식 값이 통과했습니다.');
  if (cleaned.PHONE_MOBILE === 12345) throw new Error('숫자 처리방식 값이 통과했습니다.');
  if (Object.getPrototypeOf(cleaned) !== null && '__proto__' in cleaned) {
    throw new Error('프로토타입 오염 가능성이 있습니다.');
  }
  if (Object.keys(normalizeTypePolicies(null)).length !== 0) {
    throw new Error('null 입력은 빈 정책으로 처리해야 합니다.');
  }
  console.log('  [3/3] 정책 정규화 화이트리스트');
}

// ---------- 실행 ----------

console.log('[safedoc] 통합 검증');
await assertNoNetworkOrPlainStorage();
await assertSessionNotPersisted();
await assertPolicyNormalization();

console.log('\n[safedoc] 단위 시험');

// ZIP 처리 계열은 fflate 를 동기 접근자로 쓰므로 시험 전에 한 번 적재해야 한다.
// (브라우저에서는 modules/safeDoc/index.js 가 같은 일을 한다)
const testDir = path.join(scriptsDir, 'safedoc-tests');
const files = fs.readdirSync(testDir)
  .filter((f) => f.endsWith('.test.mjs'))
  .map((f) => path.join(testDir, f));

let failed = 0;
const stream = run({
  files,
  concurrency: 1,
  setup: undefined
});
stream.on('test:fail', () => { failed += 1; });
stream.compose(spec).pipe(process.stdout);

await new Promise((resolve) => stream.on('close', resolve));

if (failed > 0) {
  console.error(`\n[safedoc] 실패 ${failed}건`);
  process.exit(1);
}
console.log('\n[safedoc] 통과');
