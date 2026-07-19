/**
 * Vitest → node:test 얇은 어댑터.
 *
 * safeDoc은 원래 Vitest로 시험했으나 myAI는 별도 러너 없이 scripts/*.mjs 를
 * `npm test`가 순차 실행하는 방식이다. Node 24 내장 node:test 로 옮기되
 * 이식한 시험 코드 6개 파일은 import 줄만 바꾸고 본문은 그대로 두기 위해
 * 실제 사용하는 매처만 최소로 구현한다.
 *
 * 구현 매처: toBe / toContain / toThrow / toBeDefined / toBeGreaterThan /
 *            toBeLessThan / toBeGreaterThanOrEqual / toBeInstanceOf
 * 수식어:    .not / .rejects
 *
 * 미구현 매처를 호출하면 조용히 통과하지 않고 즉시 실패하도록 Proxy로 막는다.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { preloadFflate } from '../public/modules/safeDoc/vendor/fflate.js';

// ZIP 계열 파서는 fflate 를 동기 접근자로 쓴다(vendor/fflate.js 주석 참고).
// 모든 시험 파일이 이 shim 을 첫 줄에서 import 하므로, 여기서 최상위 await 로
// 적재해 두면 시험 본문이 실행될 때는 이미 준비된 상태가 된다.
// (브라우저에서는 modules/safeDoc/index.js 가 같은 역할을 한다)
await preloadFflate();

export { describe, it };

function describeValue(v) {
  if (typeof v === 'string') return JSON.stringify(v.length > 200 ? `${v.slice(0, 200)}…` : v);
  if (v instanceof RegExp) return String(v);
  if (Array.isArray(v)) return `Array(${v.length})`;
  return String(v);
}

function contains(actual, expected) {
  if (typeof actual === 'string') return actual.includes(expected);
  if (Array.isArray(actual)) return actual.some((x) => x === expected);
  if (actual && typeof actual[Symbol.iterator] === 'function') return [...actual].includes(expected);
  throw new Error(`toContain: 지원하지 않는 대상 타입 (${typeof actual})`);
}

// 던져진 값이 기대와 맞는지 판정. 기대값 생략 시 "던지기만 하면 통과".
function matchesThrown(error, expected) {
  if (expected === undefined) return true;
  const message = error?.message ?? String(error);
  if (expected instanceof RegExp) return expected.test(message) || expected.test(String(error));
  if (typeof expected === 'string') return message.includes(expected);
  if (typeof expected === 'function') return error instanceof expected;
  return false;
}

function buildMatchers(actual, negated) {
  const check = (pass, detail) => {
    if (pass === !negated) return;
    assert.fail(`기대 실패${negated ? ' (not)' : ''}: ${detail}`);
  };

  const matchers = {
    toBe(expected) {
      check(Object.is(actual, expected), `${describeValue(actual)} === ${describeValue(expected)}`);
    },
    toContain(expected) {
      check(contains(actual, expected), `${describeValue(actual)} 이(가) ${describeValue(expected)} 포함`);
    },
    toBeDefined() {
      check(actual !== undefined, `${describeValue(actual)} !== undefined`);
    },
    toBeGreaterThan(expected) {
      check(actual > expected, `${describeValue(actual)} > ${describeValue(expected)}`);
    },
    toBeGreaterThanOrEqual(expected) {
      check(actual >= expected, `${describeValue(actual)} >= ${describeValue(expected)}`);
    },
    toBeLessThan(expected) {
      check(actual < expected, `${describeValue(actual)} < ${describeValue(expected)}`);
    },
    toBeInstanceOf(expected) {
      check(actual instanceof expected, `${describeValue(actual)} instanceof ${expected?.name}`);
    },
    toThrow(expected) {
      if (typeof actual !== 'function') {
        assert.fail('toThrow: expect()에 함수를 전달해야 합니다.');
      }
      let thrown;
      let didThrow = false;
      try {
        actual();
      } catch (e) {
        didThrow = true;
        thrown = e;
      }
      check(didThrow && matchesThrown(thrown, expected),
        `호출이 ${describeValue(expected)} 오류를 던짐 (실제: ${didThrow ? describeValue(thrown?.message) : '던지지 않음'})`);
    }
  };

  // 미구현 매처 호출을 조용한 통과가 아닌 즉시 실패로 만든다.
  return new Proxy(matchers, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'symbol') return undefined;
      throw new Error(`[safedoc-test-shim] 미구현 매처: ${String(prop)} — shim에 추가하십시오.`);
    }
  });
}

// Promise 대상 수식어: await expect(p).rejects.toThrow(...)
function buildRejects(promise, negated) {
  const wrap = (assertFn) => async (expected) => {
    let thrown;
    let didReject = false;
    try {
      await promise;
    } catch (e) {
      didReject = true;
      thrown = e;
    }
    const pass = didReject && matchesThrown(thrown, expected);
    if (pass === !negated) return;
    assert.fail(`기대 실패${negated ? ' (not)' : ''}: Promise가 ${describeValue(expected)} 으로 거부됨 `
      + `(실제: ${didReject ? describeValue(thrown?.message) : '정상 완료'})`);
    void assertFn;
  };
  return { toThrow: wrap('toThrow') };
}

export function expect(actual) {
  const base = buildMatchers(actual, false);
  return new Proxy(base, {
    get(target, prop) {
      if (prop === 'not') return buildMatchers(actual, true);
      if (prop === 'rejects') return buildRejects(actual, false);
      return Reflect.get(target, prop);
    }
  });
}
