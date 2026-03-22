import { loadConfig } from '../config'
import type { ResolvedFrontronConfig } from '../types'
import type { RuntimeManifest } from './manifest'

export async function loadRuntimeConfig(
  manifest: RuntimeManifest,
): Promise<ResolvedFrontronConfig | undefined> {
  if (!manifest.configFile) {
    return undefined
  }

  const loadedConfig = await loadConfig({
    cwd: manifest.rootDir,
    configFile: manifest.configFile,
  })

  return loadedConfig.config
}
