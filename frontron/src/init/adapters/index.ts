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

  // 감지는 먼저 맞은 adapter를 선택하므로 구체적인 production runtime을 fallback보다 앞에 둔다.
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
