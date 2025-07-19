import type { InitConfig } from './shared'
import { resolveDevServerUrl } from './runtime/renderers'

type InitSuccessOutput = {
  info(message: string): void
}

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
    `- desktop build and package script: ${config.buildScript}`,
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

function formatInstallCommand(packageManager: InitConfig['packageManager']) {
  return `${packageManager} install`
}

function formatRunScriptCommand(packageManager: InitConfig['packageManager'], scriptName: string) {
  return packageManager === 'yarn' ? `yarn ${scriptName}` : `${packageManager} run ${scriptName}`
}

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
    `3. Run "${formatRunScriptCommand(config.packageManager, config.buildScript)}" to build and package the desktop app.`,
  )
}
