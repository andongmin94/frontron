import type { InitConfig } from '../shared'
import { inferHost, inferPort, inferViteServerConfig, normalizeLoopbackHost } from '../detect'

const VITE_CONFIG_ADAPTERS = new Set<InitConfig['adapter']>([
  'generic-static',
  'sveltekit-static',
  'sveltekit-node',
])

// getDefaultDevPort 함수는 프레임워크 어댑터별 기본 개발 서버 포트를 돌려준다.
function getDefaultDevPort(adapter: InitConfig['adapter']) {
  return adapter === 'next-export' ||
    adapter === 'next-standalone' ||
    adapter === 'nuxt-node-server'
    ? 3000
    : 5173
}

// 루트 Vite 설정은 실제로 그 설정을 소비하는 어댑터나 명령에서만 개발 URL 근거로 사용한다.
function shouldReadViteServerConfig(config: InitConfig) {
  if (VITE_CONFIG_ADAPTERS.has(config.adapter)) {
    return true
  }

  if (config.adapter !== 'remix-node-server' && config.adapter !== 'generic-node-server') {
    return false
  }

  const devCommand = config.packageJson.scripts?.[config.webDevScript] ?? ''
  return /\bvite(?::dev)?(?:\s|$)/i.test(devCommand)
}

// IPv6 주소는 URL authority에서 대괄호가 필요하므로 문자열 연결 대신 URL 문법으로 검증한다.
function createDevServerUrl(host: string, port: number) {
  const unwrappedHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  const authorityHost = unwrappedHost.includes(':') ? `[${unwrappedHost}]` : unwrappedHost
  const url = new URL(`http://${authorityHost}`)

  if (url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`Invalid frontend dev server host "${host}".`)
  }

  url.port = String(port)
  return url.origin
}

// resolveDevServerUrl 함수는 어댑터와 script 설정을 바탕으로 dev server URL을 결정한다.
export function resolveDevServerUrl(config: InitConfig) {
  const viteServerConfig = shouldReadViteServerConfig(config)
    ? inferViteServerConfig(config.cwd)
    : { host: null, port: null }
  const devHost =
    inferHost(config.packageJson, config.webDevScript) ??
    normalizeLoopbackHost(viteServerConfig.host) ??
    'localhost'
  const inferredPort =
    inferPort(config.packageJson, config.webDevScript) ??
    Number.parseInt(viteServerConfig.port ?? '', 10)
  const defaultDevPort = getDefaultDevPort(config.adapter)
  const devPort = Number.isInteger(inferredPort) ? inferredPort : defaultDevPort

  return createDevServerUrl(devHost, devPort)
}
