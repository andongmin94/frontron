import type { InitConfig } from '../shared'
import { inferHost, inferPort, inferViteServerValue, normalizeLoopbackHost } from '../detect'

// getDefaultDevPort 함수는 프레임워크 어댑터별 기본 개발 서버 포트를 돌려준다.
function getDefaultDevPort(adapter: InitConfig['adapter']) {
  return adapter === 'next-export' ||
    adapter === 'next-standalone' ||
    adapter === 'nuxt-node-server'
    ? 3000
    : 5173
}

// resolveDevServerUrl 함수는 어댑터와 script 설정을 바탕으로 dev server URL을 결정한다.
export function resolveDevServerUrl(config: InitConfig) {
  const devHost =
    inferHost(config.packageJson, config.webDevScript) ??
    normalizeLoopbackHost(inferViteServerValue(config.cwd, 'host')) ??
    'localhost'
  const inferredPort =
    inferPort(config.packageJson, config.webDevScript) ??
    Number.parseInt(inferViteServerValue(config.cwd, 'port') ?? '', 10)
  const defaultDevPort = getDefaultDevPort(config.adapter)
  const devPort = Number.isInteger(inferredPort) ? inferredPort : defaultDevPort

  return `http://${devHost}:${devPort}`
}
