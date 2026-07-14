import { join } from 'node:path'

import { createManifest, MANIFEST_PATH, renderManifestSource } from './manifest'
import type { PackageJsonOwnershipClaim } from './manifest'
import { createDesktopScriptCommands } from './package-json'
import {
  renderElectronPackageSource,
  renderServeSource,
  renderTsconfigSource,
} from './runtime/renderers'
import {
  loadCreateFrontronTemplate,
  type CreateFrontronTemplateSnapshot,
} from './runtime/create-frontron-template'
import type { InitConfig } from './shared'
import type { YarnRcOwnershipClaim } from './yarnrc-yaml'

// createInitFileSources 함수는 init이 새 프로젝트에 쓸 Electron 관련 파일 소스를 만든다.
export function createInitFileSources(
  config: InitConfig,
  template: CreateFrontronTemplateSnapshot = loadCreateFrontronTemplate(),
) {
  const filesToWrite = new Map<string, string>([
    [join(config.cwd, config.desktopDir, 'serve.ts'), renderServeSource(config)],
    [join(config.cwd, config.desktopDir, 'package.json'), renderElectronPackageSource()],
    [join(config.cwd, 'tsconfig.electron.json'), renderTsconfigSource(config.desktopDir)],
  ])

  for (const [fileName, source] of template.electronFiles) {
    filesToWrite.set(join(config.cwd, config.desktopDir, fileName), source)
  }

  filesToWrite.set(join(config.cwd, 'src', 'types', 'electron.d.ts'), template.electronTypeSource)

  return filesToWrite
}

// addManifestSource 함수는 생성 파일 목록 끝에 Frontron manifest 파일 내용을 추가한다.
export function addManifestSource(
  config: InitConfig,
  filesToWrite: Map<string, string>,
  packageJsonClaims: PackageJsonOwnershipClaim[],
  tsconfigJsonClaims: PackageJsonOwnershipClaim[],
  pnpmWorkspaceClaims: PackageJsonOwnershipClaim[],
  yarnRcClaims: YarnRcOwnershipClaim[],
) {
  const manifestPath = join(config.cwd, MANIFEST_PATH)

  // manifest 파일 자체는 해시 대상에서 제외한다.
  // 자기 자신의 내용이 자기 해시에 영향을 주면 매번 값이 바뀌기 때문이다.
  filesToWrite.set(
    manifestPath,
    renderManifestSource(
      createManifest(
        config,
        filesToWrite,
        [manifestPath],
        createDesktopScriptCommands(config),
        packageJsonClaims,
        tsconfigJsonClaims,
        pnpmWorkspaceClaims,
        yarnRcClaims,
      ),
    ),
  )

  return manifestPath
}
