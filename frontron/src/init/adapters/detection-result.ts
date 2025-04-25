import type { AdapterConfidence, AdapterDetectionResult } from '../shared'

// detected 함수는 어댑터 감지 성공 결과를 표준 형식으로 만든다.
export function detected(
  confidence: AdapterConfidence,
  reasons: string[],
  warnings: string[] = [],
): AdapterDetectionResult {
  return {
    matched: true,
    confidence,
    reasons,
    warnings,
  }
}

// notDetected 함수는 어댑터 감지 실패 결과를 표준 형식으로 만든다.
export function notDetected(reason: string): AdapterDetectionResult {
  return {
    matched: false,
    confidence: 'low',
    reasons: [reason],
    warnings: [],
  }
}
