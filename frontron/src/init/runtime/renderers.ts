import type { InitPreset } from '../shared'
import { usesStarterBridge } from '../shared'
import {
  getInitTemplateInfo,
  readCreateFrontronTemplateFile,
  renderCreateFrontronElectronFile,
} from './create-frontron-template'
import { renderMinimalMainSource, renderMinimalWindowSource } from './minimal-sources'
import { resolveDevServerUrl } from './dev-server-url'
import { renderServeSource } from './serve-source'

export { getInitTemplateInfo }
export { resolveDevServerUrl, renderServeSource }

// renderMainSource 함수는 선택한 preset에 맞는 Electron main.ts 소스를 만든다.
export function renderMainSource(preset: InitPreset) {
  if (usesStarterBridge(preset)) {
    return renderCreateFrontronElectronFile('main.ts')
  }

  return renderMinimalMainSource()
}

// renderWindowSource 함수는 선택한 preset에 맞는 Electron window.ts 소스를 만든다.
export function renderWindowSource(preset: InitPreset) {
  if (usesStarterBridge(preset)) {
    return renderCreateFrontronElectronFile('window.ts')
  }

  return renderMinimalWindowSource()
}

// renderPreloadSource 함수는 starter-like preset의 preload 소스를 만든다.
export function renderPreloadSource() {
  return renderCreateFrontronElectronFile('preload.ts')
}

// renderIpcSource 함수는 starter-like preset의 IPC helper 소스를 만든다.
export function renderIpcSource() {
  return renderCreateFrontronElectronFile('ipc.ts')
}

// renderElectronTypesSource 함수는 renderer에서 preload API 타입을 볼 수 있는 타입 선언 소스를 만든다.
export function renderElectronTypesSource() {
  return readCreateFrontronTemplateFile('src/types/electron.d.ts')
}

// renderDevSource 함수는 starter-like preset의 dev helper 소스를 만든다.
export function renderDevSource() {
  return renderCreateFrontronElectronFile('dev.ts')
}

// renderSplashSource 함수는 starter-like preset의 splash window 소스를 만든다.
export function renderSplashSource() {
  return renderCreateFrontronElectronFile('splash.ts')
}

// renderTraySource 함수는 starter-like preset의 tray helper 소스를 만든다.
export function renderTraySource() {
  return renderCreateFrontronElectronFile('tray.ts')
}

// renderTsconfigSource 함수는 Electron 전용 tsconfig.electron.json 내용을 만든다.
export function renderTsconfigSource(desktopDir: string) {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2020',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        rootDir: `./${desktopDir}`,
        outDir: './dist-electron',
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        noEmitOnError: true,
        types: ['node'],
      },
      include: [`${desktopDir}/**/*.ts`],
    },
    null,
    2,
  )}\n`
}

// renderElectronPackageSource 함수는 Electron 소스 폴더에 둘 package.json 내용을 만든다.
export function renderElectronPackageSource() {
  return `${JSON.stringify({ type: 'module' }, null, 2)}\n`
}
