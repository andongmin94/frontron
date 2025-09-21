import type { InitConfig } from '../shared'
import { resolveDevServerUrl } from './dev-server-url'
import { renderServeDevAndBuildSource } from './serve-source/dev-build-source'
import { renderServeHeaderAndConfigSource } from './serve-source/header-config-source'
import {
  renderChildProcessRuntimeSource,
  renderNodeServerRuntimeSource,
} from './serve-source/node-process-runtime-source'
import { renderStaticServerSource } from './serve-source/static-server-source'

export function renderServeSource(config: InitConfig) {
  const rendererRuntime =
    config.runtimeStrategy === 'node-server'
      ? renderNodeServerRuntimeSource()
      : renderStaticServerSource()

  return `${[
    renderServeHeaderAndConfigSource(config, resolveDevServerUrl(config)),
    renderChildProcessRuntimeSource(),
    rendererRuntime,
    renderServeDevAndBuildSource(config),
  ].join('\n\n')}\n`
}
