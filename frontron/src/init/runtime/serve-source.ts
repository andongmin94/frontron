import type { InitConfig } from '../shared'
import { resolveDevServerUrl } from './dev-server-url'
import { renderServeDevAndBuildSource } from './serve-source/dev-build-source'
import { renderServeHeaderAndConfigSource } from './serve-source/header-config-source'
import {
  renderChildProcessRuntimeSource,
  renderNodeServerRuntimeSource,
} from './serve-source/node-process-runtime-source'
import { renderStaticServerSource } from './serve-source/static-server-source'

// renderServeSource 함수는 책임별 소스 조각을 단일 electron/serve.ts 파일로 조합한다.
export function renderServeSource(config: InitConfig) {
  const devUrl = resolveDevServerUrl(config)
  const rendererRuntimeSource =
    config.runtimeStrategy === 'node-server'
      ? renderNodeServerRuntimeSource()
      : renderStaticServerSource()

  return `${renderServeHeaderAndConfigSource(config, devUrl)}

${renderChildProcessRuntimeSource()}

${rendererRuntimeSource}

${renderServeDevAndBuildSource(config)}
`
}
