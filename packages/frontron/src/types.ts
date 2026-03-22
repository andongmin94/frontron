export interface FrontronAppConfig {
  name: string
  id: string
  icon?: string
}

export interface FrontronWebDevConfig {
  command: string
  url: string
}

export interface FrontronWebBuildConfig {
  command: string
  outDir: string
}

export interface FrontronWindowConfig {
  route: string
  width?: number
  height?: number
  frame?: boolean
  resizable?: boolean
  title?: string
  [key: string]: unknown
}

export type FrontronWindowsConfig = Record<string, FrontronWindowConfig>
export type FrontronBridgeHandler = (...args: unknown[]) => unknown | Promise<unknown>
export type FrontronBridgeNamespace = Record<string, FrontronBridgeHandler>
export type FrontronBridgeConfig = Record<string, FrontronBridgeNamespace>

export interface FrontronWindowState {
  isMaximized: boolean
  isMinimized: boolean
}

export interface FrontronDesktopContext {
  rootDir: string
  mode: 'development' | 'production'
  app: {
    quit(): void
  }
  shell: {
    openExternal(input: string | { url: string }): Promise<void>
  }
  window: {
    show(): void
    hide(): void
    focus(): void
    minimize(): void
    toggleMaximize(): void
    getState(): FrontronWindowState
  }
}

export type FrontronMenuHandler = (
  context: FrontronDesktopContext,
) => unknown | Promise<unknown>

export interface FrontronMenuItemConfig {
  label?: string
  type?: 'normal' | 'separator' | 'submenu' | 'checkbox'
  role?: string
  accelerator?: string
  enabled?: boolean
  checked?: boolean
  submenu?: FrontronMenuConfig
  onClick?: FrontronMenuHandler
}

export type FrontronMenuConfig = FrontronMenuItemConfig[]

export interface FrontronTrayConfig {
  icon?: string
  tooltip?: string
  items?: FrontronMenuConfig
  onClick?: FrontronMenuHandler
}

export interface FrontronHookContext {
  rootDir: string
  configPath: string
  command: 'dev' | 'build'
  stageDir?: string
  packagedAppDir?: string
  outputDir?: string
}

export type FrontronHook =
  | string
  | ((context: FrontronHookContext) => unknown | Promise<unknown>)

export interface FrontronHooksConfig {
  beforeDev?: FrontronHook
  beforeBuild?: FrontronHook
  afterPack?: FrontronHook
}

export type FrontronRustValueType = 'void' | 'int' | 'double' | 'bool' | 'string'

export interface FrontronRustBindingConfig {
  symbol: string
  args?: readonly FrontronRustValueType[]
  returns?: FrontronRustValueType
}

export type FrontronRustBridgeNamespace = Record<string, FrontronRustBindingConfig>
export type FrontronRustBridgeConfig = Record<string, FrontronRustBridgeNamespace>

export interface FrontronRustConfig {
  enabled?: boolean
  bridge?: FrontronRustBridgeConfig
}

export interface FrontronNativeStatus {
  enabled: boolean
  loaded: boolean
  ready: boolean
  artifactPath?: string
  symbolName?: string
}

export interface ResolvedFrontronRustConfig {
  enabled: boolean
  path: string
  cargoTomlPath: string
  sourceDir: string
  libRsPath: string
  bridge?: FrontronRustBridgeConfig
}

export interface FrontronConfig {
  app: FrontronAppConfig
  web?: {
    dev?: FrontronWebDevConfig
    build?: FrontronWebBuildConfig
  }
  windows?: FrontronWindowsConfig
  bridge?: FrontronBridgeConfig
  tray?: FrontronTrayConfig
  menu?: FrontronMenuConfig
  hooks?: FrontronHooksConfig
  rust?: boolean | FrontronRustConfig
}

export interface ResolvedFrontronConfig
  extends Omit<FrontronConfig, 'rust'> {
  rust?: ResolvedFrontronRustConfig
}

export interface LoadedFrontronConfig {
  rootDir: string
  configPath: string
  config: ResolvedFrontronConfig
}

export interface LoadConfigOptions {
  cwd?: string
  configFile?: string
}
