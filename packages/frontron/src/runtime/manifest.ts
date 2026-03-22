import type { FrontronWindowsConfig } from '../types'

export interface RuntimeManifest {
  rootDir: string
  configFile?: string
  mode: 'development' | 'production'
  app: {
    name: string
    id: string
    version: string
    icon?: string
  }
  web: {
    devUrl?: string
    outDir?: string
  }
  windows: FrontronWindowsConfig
}
