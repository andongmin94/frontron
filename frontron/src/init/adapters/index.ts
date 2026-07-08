import {
  type AdapterConfidence,
  type InitAdapter,
  type InitAdapterId,
  type PackageJson,
  normalizeAdapterValue,
} from '../shared'
import { genericNodeServerAdapter, genericStaticAdapter } from './generic'
import { nextExportAdapter, nextStandaloneAdapter } from './next'
import { nuxtNodeServerAdapter, remixNodeServerAdapter } from './node-frameworks'
import { svelteKitNodeAdapter, svelteKitStaticAdapter } from './sveltekit'

// Detection is first-match-wins, so this order is part of the adapter contract.
// Put more specific production runtimes before generic or static fallbacks.
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

// getInitAdapterById 함수는 어댑터 ID에 해당하는 init 어댑터를 찾는다.
function getInitAdapterById(id: InitAdapterId) {
  const adapter = INIT_ADAPTERS.find((entry) => entry.id === id)

  if (!adapter) {
    throw new Error(`Unsupported adapter "${id}".`)
  }

  return adapter
}

// resolveInitAdapter 함수는 사용자 지정 또는 자동 감지 결과로 init 어댑터를 결정한다.
export function resolveInitAdapter(
  cwd: string,
  packageJson: PackageJson,
  requestedAdapter: string | undefined,
) {
  if (requestedAdapter) {
    return getInitAdapterById(normalizeAdapterValue(requestedAdapter))
  }

  return (
    INIT_ADAPTERS.find((adapter) => adapter.detect(cwd, packageJson).matched) ??
    genericStaticAdapter
  )
}

// describeInitAdapterSelection 함수는 선택된 어댑터의 신뢰도와 선택 이유를 설명한다.
export function describeInitAdapterSelection(
  adapter: InitAdapter,
  requestedAdapter: string | undefined,
  cwd: string,
  packageJson: PackageJson,
): {
  confidence: AdapterConfidence
  reasons: string[]
  warnings: string[]
} {
  if (requestedAdapter) {
    return {
      confidence: 'high',
      reasons: [`Adapter was explicitly selected with --adapter ${requestedAdapter}.`],
      warnings: [],
    }
  }

  const detection = adapter.detect(cwd, packageJson)

  return {
    confidence: detection.confidence,
    reasons: detection.reasons,
    warnings: detection.warnings,
  }
}
