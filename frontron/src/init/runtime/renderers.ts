import { getInitTemplateInfo } from './create-frontron-template'
import { resolveDevServerUrl } from './dev-server-url'
import { renderServeSource } from './serve-source'

export { getInitTemplateInfo }
export { resolveDevServerUrl, renderServeSource }

// renderTsconfigSource 함수는 Electron 전용 tsconfig.electron.json 내용을 만든다.
export function renderTsconfigSource(desktopDir: string) {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2020',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        moduleDetection: 'legacy',
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
