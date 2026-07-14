import type { InitConfig } from './shared'
import { resolveDevServerUrl } from './runtime/renderers'

type InitSuccessOutput = {
  info(message: string): void
}

// createSummary 함수는 init 완료 후 보여줄 핵심 설정 요약 줄을 만든다.
export function createSummary(config: InitConfig) {
  const templateSummary = `create-frontron@${config.templateInfo.packageVersion} (${config.templateInfo.resolvedFrom})`
  const lines = [
    `- Electron template: ${templateSummary}`,
    `- adapter: ${config.adapter}`,
    `- adapter confidence: ${config.adapterConfidence}`,
    ...config.adapterReasons.map((reason) => `- adapter reason: ${reason}`),
    `- runtime strategy: ${config.runtimeStrategy}`,
    `- frontend dev script: ${config.webDevScript}`,
    `- frontend build script: ${config.webBuildScript}`,
    `- Electron directory: ${config.desktopDir}`,
    `- desktop dev script: ${config.appScript}`,
    `- desktop build script: ${config.buildScript}`,
    `- desktop package script: ${config.packageScript}`,
    `- frontend output: ${config.outDir}`,
    `- package manager: ${config.packageManager}`,
    '- preload bridge: window.electron',
  ]

  if (config.runtimeStrategy === 'node-server') {
    lines.push(`- server runtime root: ${config.nodeServerSourceRoot ?? '(unset)'}`)
    if (config.nodeServerSourceEntry) {
      lines.push(`- server source entry: ${config.nodeServerSourceEntry}`)
    }
    lines.push(`- server entry: ${config.nodeServerEntry ?? '(unset)'}`)
  }

  return lines.join('\n')
}

// formatInstallCommand 함수는 패키지 매니저에 맞는 install 명령을 표시용 문자열로 만든다.
function formatInstallCommand(packageManager: InitConfig['packageManager']) {
  return `${packageManager} install`
}

// formatRunScriptCommand 함수는 패키지 매니저에 맞는 script 실행 명령을 표시용 문자열로 만든다.
function formatRunScriptCommand(packageManager: InitConfig['packageManager'], scriptName: string) {
  return packageManager === 'yarn' ? `yarn ${scriptName}` : `${packageManager} run ${scriptName}`
}

// writeInitSuccessReport 함수는 init 성공 후 사용자가 실행할 다음 명령을 출력한다.
export function writeInitSuccessReport(
  output: InitSuccessOutput,
  config: InitConfig,
  scriptFallbackWarnings: string[],
) {
  output.info('[Frontron] Added the create-frontron Electron retrofit layer.')
  output.info(createSummary(config))

  if (scriptFallbackWarnings.length > 0) {
    output.info('')
    output.info('Warnings:')

    for (const warning of scriptFallbackWarnings) {
      output.info(`- ${warning}`)
    }
  }

  // 마지막 안내를 이 함수에 모아 runInit이 계획 계산과 파일 적용에만 집중하게 한다.
  output.info('')
  output.info('Next steps:')
  output.info(
    `1. Run "${formatInstallCommand(config.packageManager)}" to install the new desktop dependencies.`,
  )
  output.info(
    `2. Run "${formatRunScriptCommand(config.packageManager, config.appScript)}" to start the desktop app.`,
  )
  output.info(`   The dev runner waits for ${resolveDevServerUrl(config)}.`)
  output.info(
    `3. Run "${formatRunScriptCommand(config.packageManager, config.buildScript)}" to prepare the desktop build.`,
  )
  output.info(
    `4. Run "${formatRunScriptCommand(config.packageManager, config.packageScript)}" to create a packaged build when you are ready to distribute.`,
  )
}
