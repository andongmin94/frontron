import {
  type AdapterConfidence,
  type AdapterDetectionResult,
  type InitAdapter,
  type InitAdapterId,
  type PackageJson,
  normalizeAdapterValue,
} from '../shared'
import { genericNodeServerAdapter, genericStaticAdapter } from './generic'
import { nextExportAdapter, nextStandaloneAdapter } from './next'
import { nuxtNodeServerAdapter, remixNodeServerAdapter } from './node-frameworks'
import { svelteKitNodeAdapter, svelteKitStaticAdapter } from './sveltekit'

// 동률일 때만 이 순서를 사용하며, 실제 선택 우선순위는 감지 신뢰도가 결정한다.
const INIT_ADAPTERS: readonly InitAdapter[] = [
  nextStandaloneAdapter,
  nuxtNodeServerAdapter,
  remixNodeServerAdapter,
  nextExportAdapter,
  svelteKitNodeAdapter,
  svelteKitStaticAdapter,
  genericNodeServerAdapter,
  genericStaticAdapter,
]

const ADAPTER_CONFIDENCE_RANK: Record<AdapterConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
}

type DetectedInitAdapter = {
  adapter: InitAdapter
  detection: AdapterDetectionResult
}

export type InitAdapterSelection = {
  adapter: InitAdapter
  confidence: AdapterConfidence
  reasons: string[]
  warnings: string[]
}

// getInitAdapterById 함수는 어댑터 ID에 해당하는 init 어댑터를 찾는다.
function getInitAdapterById(id: InitAdapterId) {
  const adapter = INIT_ADAPTERS.find((entry) => entry.id === id)

  if (!adapter) {
    throw new Error(`Unsupported adapter "${id}".`)
  }

  return adapter
}

// resolveInitAdapterSelection 함수는 모든 감지 결과를 한 번만 계산한 뒤 가장 강한 근거를 선택한다.
export function resolveInitAdapterSelection(
  cwd: string,
  packageJson: PackageJson,
  requestedAdapter: string | undefined,
): InitAdapterSelection {
  if (requestedAdapter) {
    const adapter = getInitAdapterById(normalizeAdapterValue(requestedAdapter))

    return {
      adapter,
      confidence: 'high',
      reasons: [`Adapter was explicitly selected with --adapter ${requestedAdapter}.`],
      warnings: [],
    }
  }

  const detectedAdapters: DetectedInitAdapter[] = INIT_ADAPTERS.map((adapter) => ({
    adapter,
    detection: adapter.detect(cwd, packageJson),
  }))
  const matchedAdapters = detectedAdapters.filter(({ detection }) => detection.matched)
  const highestConfidenceRank = Math.max(
    ...matchedAdapters.map(({ detection }) => ADAPTER_CONFIDENCE_RANK[detection.confidence]),
  )
  const highestConfidenceAdapters = matchedAdapters.filter(
    ({ detection }) => ADAPTER_CONFIDENCE_RANK[detection.confidence] === highestConfidenceRank,
  )
  const specificAdapters = highestConfidenceAdapters.filter(
    ({ adapter }) => adapter.id !== 'generic-static',
  )
  const finalists = specificAdapters.length > 0 ? specificAdapters : highestConfidenceAdapters

  if (finalists.length > 1) {
    const candidateIds = finalists.map(({ adapter }) => `"${adapter.id}"`).join(', ')
    const confidence = finalists[0].detection.confidence

    // 같은 강도의 구체 어댑터를 배열 순서로 고르면 잘못된 런타임을 패키징할 수 있어 명시 선택을 요구한다.
    throw new Error(
      `Ambiguous adapter detection at ${confidence} confidence: ${candidateIds}. Pass --adapter <id> to select one explicitly.`,
    )
  }

  const selected = finalists[0]

  if (!selected) {
    throw new Error('No init adapter matched the current project.')
  }

  const genericFallbackAlsoMatched = highestConfidenceAdapters.some(
    ({ adapter }) => adapter.id === 'generic-static' && adapter !== selected.adapter,
  )

  return {
    adapter: selected.adapter,
    confidence: selected.detection.confidence,
    reasons: selected.detection.reasons,
    warnings: [
      ...selected.detection.warnings,
      ...(genericFallbackAlsoMatched
        ? [
            `Adapter detection also matched the generic-static fallback at ${selected.detection.confidence} confidence; selected the more specific ${selected.adapter.id} adapter. Pass --adapter to override this choice.`,
          ]
        : []),
    ],
  }
}
