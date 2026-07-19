// 여권번호·사업자등록번호·차량번호·IP주소·생년월일 탐지 (FR-307~310, FR-313)

import { validateBusinessNo, validateDate, validateIPv4 } from '../validators.js';
import { fieldKeywordScore, digitBoundaryPenalty, makeCandidate } from './helpers.js';

// 여권번호: M12345678 등 (구여권 1자리+8자리, 차세대 1자리+3자리+4자리 포함)
const PASSPORT_REGEX = /\b[MSRODT]\d{3}[A-Z]?\d{4,5}\b/g;

// 사업자등록번호: 000-00-00000
const BUSINESS_REGEX = /\d{3}-\d{2}-\d{5}/g;

// 차량번호: 12가3456, 123가4567, 서울12가3456 (지역 접두는 실제 시·도 약칭만 허용)
const VEHICLE_REGEX = /(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)\s?)?\d{2,3}[가-힣]\s?\d{4}(?![\d])/g;

// IPv4 / IPv6
const IPV4_REGEX = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
const IPV6_REGEX = /\b(?:[0-9A-Fa-f]{1,4}:){2,7}[0-9A-Fa-f]{1,4}\b/g;

// 생년월일: 1990-01-01, 1990.01.01, 1990년 1월 1일 등
const BIRTH_REGEX = /(19\d{2}|20[0-2]\d)[.\-\/년\s]\s?(0?[1-9]|1[0-2])[.\-\/월\s]\s?(0?[1-9]|[12]\d|3[01])일?/g;

const VEHICLE_USE_CHARS = '가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주하허호배';

export function detectPassport(text) {
  const results = [];
  for (const m of text.matchAll(PASSPORT_REGEX)) {
    const start = m.index;
    const end = start + m[0].length;
    const digits = m[0].replace(/[^0-9]/g, '');
    if (digits.length < 8 || digits.length > 8) continue;
    let score = 0.45 + fieldKeywordScore(text, start, 'PASSPORT_NO') * 3;
    if (score < 0.45) score = 0.45;
    results.push(makeCandidate({ text, start, end, type: 'PASSPORT_NO', baseScore: Math.min(score, 1), detectionMethod: 'REGEX' }));
  }
  return results;
}

export function detectBusinessNo(text) {
  const results = [];
  for (const m of text.matchAll(BUSINESS_REGEX)) {
    const digits = m[0].replace(/-/g, '');
    const v = validateBusinessNo(digits);
    if (!v.valid) continue;
    const start = m.index;
    const end = start + m[0].length;
    let score = 0.5 + 0.35;
    score += fieldKeywordScore(text, start, 'BUSINESS_NO');
    score -= digitBoundaryPenalty(text, start, end);
    results.push(makeCandidate({ text, start, end, type: 'BUSINESS_NO', baseScore: Math.min(score, 1), detectionMethod: 'REGEX' }));
  }
  return results;
}

export function detectVehicle(text) {
  const results = [];
  for (const m of text.matchAll(VEHICLE_REGEX)) {
    const raw = m[0];
    // 용도기호가 실제 차량용 한글인지 확인 (오탐 축소)
    const useChar = raw.match(/\d{2,3}([가-힣])/);
    if (!useChar || !VEHICLE_USE_CHARS.includes(useChar[1])) continue;
    const start = m.index;
    const end = start + raw.length;
    let score = 0.5 + 0.2;
    score += fieldKeywordScore(text, start, 'VEHICLE_NO');
    score -= digitBoundaryPenalty(text, start, end);
    if (score < 0.3) continue;
    results.push(makeCandidate({ text, start, end, type: 'VEHICLE_NO', baseScore: Math.min(score, 1), detectionMethod: 'REGEX' }));
  }
  return results;
}

export function detectIP(text) {
  const results = [];
  for (const m of text.matchAll(IPV4_REGEX)) {
    if (!validateIPv4(m[0])) continue;
    const start = m.index;
    const end = start + m[0].length;
    // 버전 번호(1.0.0.1 등) 오탐 축소: 각 옥텟이 모두 한 자리면 감점
    let score = 0.45 + 0.25;
    if (m[0].split('.').every((p) => p.length === 1)) score -= 0.25;
    score += fieldKeywordScore(text, start, 'IP_ADDRESS');
    if (score < 0.3) continue;
    results.push(makeCandidate({ text, start, end, type: 'IP_ADDRESS', baseScore: Math.min(score, 1), detectionMethod: 'REGEX' }));
  }
  for (const m of text.matchAll(IPV6_REGEX)) {
    if (!m[0].includes(':') || m[0].split(':').length < 4) continue;
    const start = m.index;
    const end = start + m[0].length;
    results.push(makeCandidate({ text, start, end, type: 'IP_ADDRESS', baseScore: 0.7, detectionMethod: 'REGEX' }));
  }
  return results;
}

export function detectBirthDate(text) {
  const results = [];
  for (const m of text.matchAll(BIRTH_REGEX)) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!validateDate(y, mo, d)) continue;
    const start = m.index;
    const end = start + m[0].length;
    // 날짜는 흔하므로 필드명이 있을 때만 신뢰도 상승 (FR-313: 생년월일로 추정되는 정보)
    const fieldScore = fieldKeywordScore(text, start, 'BIRTH_DATE');
    let score = 0.35 + 0.15 + fieldScore * 3;
    if (score < 0.4) continue;
    results.push(makeCandidate({
      text, start, end, type: 'BIRTH_DATE', baseScore: Math.min(score, 1),
      detectionMethod: fieldScore > 0 ? 'CONTEXT' : 'REGEX',
    }));
  }
  return results;
}
