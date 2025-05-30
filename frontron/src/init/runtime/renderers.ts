import type { InitPreset } from '../shared'
import { usesStarterBridge } from '../shared'
import { getInitTemplateInfo, renderCreateFrontronElectronFile } from './create-frontron-template'
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
