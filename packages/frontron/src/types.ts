export interface FrontronAppConfig {
  name: string
  id: string
  icon?: string
  description?: string
  author?: string
  copyright?: string
}

export interface FrontronWebDevConfig {
  command: string
  url: string
}

export interface FrontronWebBuildConfig {
  command: string
  outDir: string
}

export type FrontronSecurityNavigationPolicy = 'allow' | 'deny' | 'openExternal'

export type FrontronTitleBarStyle =
  | 'default'
  | 'hidden'
  | 'hiddenInset'
  | 'customButtonsOnHover'

export type FrontronAdvancedScalar = string | number | boolean | null
export type FrontronAdvancedValue =
  | FrontronAdvancedScalar
  | FrontronAdvancedValue[]
  | { [key: string]: FrontronAdvancedValue }
export type FrontronAdvancedObject = Record<string, FrontronAdvancedValue>

export interface FrontronWindowConfig {
  route: string
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  frame?: boolean
  resizable?: boolean
  show?: boolean
  center?: boolean
  fullscreen?: boolean
  fullscreenable?: boolean
  maximizable?: boolean
  minimizable?: boolean
  closable?: boolean
  alwaysOnTop?: boolean
  backgroundColor?: string
  transparent?: boolean
  autoHideMenuBar?: boolean
  skipTaskbar?: boolean
  title?: string
  titleBarStyle?: FrontronTitleBarStyle
  zoomFactor?: number
  sandbox?: boolean
  spellcheck?: boolean
  webSecurity?: boolean
  advanced?: FrontronAdvancedObject
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

export interface FrontronDeepLinksConfig {
  enabled?: boolean
  name?: string
  schemes?: string | readonly string[]
}

export interface ResolvedFrontronDeepLinksConfig
  extends Omit<FrontronDeepLinksConfig, 'enabled' | 'schemes'> {
  enabled: boolean
  schemes: string[]
}

export interface FrontronDeepLinkState {
  enabled: boolean
  schemes: string[]
  pending: string[]
  last?: string
}

export type FrontronUpdateStatus =
  | 'disabled'
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloaded'
  | 'error'

export interface FrontronUpdateState {
  enabled: boolean
  supported: boolean
  status: FrontronUpdateStatus
  currentVersion?: string
  latestVersion?: string
  error?: string
}

export type FrontronUpdateProvider = 'generic'

export interface FrontronUpdatesConfig {
  enabled?: boolean
  provider?: FrontronUpdateProvider
  url?: string
  checkOnLaunch?: boolean
}

export interface ResolvedFrontronUpdatesConfig
  extends Omit<FrontronUpdatesConfig, 'enabled' | 'provider' | 'checkOnLaunch'> {
  enabled: boolean
  provider: FrontronUpdateProvider
  checkOnLaunch: boolean
}

export interface FrontronSecurityConfig {
  externalNavigation?: FrontronSecurityNavigationPolicy
  newWindow?: FrontronSecurityNavigationPolicy
}

export interface ResolvedFrontronSecurityConfig {
  externalNavigation: FrontronSecurityNavigationPolicy
  newWindow: FrontronSecurityNavigationPolicy
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
  windows: {
    open(name: string): Promise<void>
    show(name: string): Promise<void>
    hide(name: string): void
    focus(name: string): void
    close(name: string): void
    minimize(name: string): void
    toggleMaximize(name: string): void
    exists(name: string): boolean
    getState(name: string): FrontronWindowState | null
    listConfigured(): string[]
    listOpen(): string[]
  }
  deepLinks: {
    getState(): FrontronDeepLinkState
    consumePending(): string[]
  }
  updates: {
    getState(): FrontronUpdateState
    check(): Promise<FrontronUpdateState>
    quitAndInstall(): boolean
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

export type FrontronPublishMode = 'never' | 'always' | 'onTag' | 'onTagOrDraft'
export type FrontronBuildCompression = 'store' | 'normal' | 'maximum'
export type FrontronRequestedExecutionLevel =
  | 'asInvoker'
  | 'highestAvailable'
  | 'requireAdministrator'
export type FrontronFileAssociationRole = 'Editor' | 'Viewer' | 'Shell' | 'None'
export type FrontronFileAssociationRank = 'Owner' | 'Default' | 'Alternate' | 'None'

export interface FrontronBuildFileSet {
  from: string
  to?: string
  filter?: string | readonly string[]
}

export type FrontronBuildFilePattern = string | FrontronBuildFileSet

export interface FrontronBuildFileAssociation {
  ext: string | readonly string[]
  name?: string
  description?: string
  mimeType?: string
  icon?: string
  role?: FrontronFileAssociationRole
  isPackage?: boolean
  rank?: FrontronFileAssociationRank
}

export type FrontronWindowsBuildTarget = 'dir' | 'nsis' | 'portable'
export type FrontronMacBuildTarget =
  | 'default'
  | 'dmg'
  | 'mas'
  | 'mas-dev'
  | 'pkg'
  | '7z'
  | 'zip'
  | 'tar.xz'
  | 'tar.lz'
  | 'tar.gz'
  | 'tar.bz2'
  | 'dir'
export type FrontronLinuxBuildTarget =
  | 'AppImage'
  | 'flatpak'
  | 'snap'
  | 'deb'
  | 'rpm'
  | 'freebsd'
  | 'pacman'
  | 'p5p'
  | 'apk'
  | '7z'
  | 'zip'
  | 'tar.xz'
  | 'tar.lz'
  | 'tar.gz'
  | 'tar.bz2'
  | 'dir'

export interface FrontronBuildWindowsConfig {
  targets?: FrontronWindowsBuildTarget | readonly FrontronWindowsBuildTarget[]
  icon?: string
  publisherName?: string | readonly string[]
  certificateSubjectName?: string
  signAndEditExecutable?: boolean
  requestedExecutionLevel?: FrontronRequestedExecutionLevel
  artifactName?: string
}

export interface FrontronBuildNsisConfig {
  oneClick?: boolean
  perMachine?: boolean
  allowToChangeInstallationDirectory?: boolean
  deleteAppDataOnUninstall?: boolean
  installerIcon?: string
  uninstallerIcon?: string
}

export interface FrontronBuildMacConfig {
  targets?: FrontronMacBuildTarget | readonly FrontronMacBuildTarget[]
  icon?: string
  category?: string
  identity?: string
  hardenedRuntime?: boolean
  gatekeeperAssess?: boolean
  entitlements?: string
  entitlementsInherit?: string
  artifactName?: string
}

export interface FrontronBuildLinuxConfig {
  targets?: FrontronLinuxBuildTarget | readonly FrontronLinuxBuildTarget[]
  icon?: string
  category?: string
  packageCategory?: string
  artifactName?: string
}

export interface FrontronBuildAdvancedConfig {
  electronBuilder?: FrontronAdvancedObject
}

export interface FrontronBuildConfig {
  outputDir?: string
  artifactName?: string
  publish?: FrontronPublishMode
  asar?: boolean
  compression?: FrontronBuildCompression
  files?: readonly FrontronBuildFilePattern[]
  extraResources?: readonly FrontronBuildFilePattern[]
  extraFiles?: readonly FrontronBuildFilePattern[]
  fileAssociations?: readonly FrontronBuildFileAssociation[]
  windows?: FrontronBuildWindowsConfig
  nsis?: FrontronBuildNsisConfig
  mac?: FrontronBuildMacConfig
  linux?: FrontronBuildLinuxConfig
  advanced?: FrontronBuildAdvancedConfig
}

export interface ResolvedFrontronBuildFileSet {
  from: string
  to?: string
  filter?: string[]
}

export type ResolvedFrontronBuildFilePattern = string | ResolvedFrontronBuildFileSet

export interface ResolvedFrontronBuildFileAssociation
  extends Omit<FrontronBuildFileAssociation, 'ext'> {
  ext: string[]
}

export interface ResolvedFrontronBuildNsisConfig
  extends Omit<FrontronBuildNsisConfig, 'installerIcon' | 'uninstallerIcon'> {
  installerIcon?: string
  uninstallerIcon?: string
}

export interface ResolvedFrontronBuildWindowsConfig
  extends Omit<FrontronBuildWindowsConfig, 'targets' | 'publisherName'> {
  targets?: string[]
  publisherName?: string[]
}

export interface ResolvedFrontronBuildMacConfig
  extends Omit<FrontronBuildMacConfig, 'targets'> {
  targets?: string[]
}

export interface ResolvedFrontronBuildLinuxConfig
  extends Omit<FrontronBuildLinuxConfig, 'targets'> {
  targets?: string[]
}

export interface ResolvedFrontronBuildConfig
  extends Omit<
    FrontronBuildConfig,
    | 'windows'
    | 'nsis'
    | 'mac'
    | 'linux'
    | 'files'
    | 'extraResources'
    | 'extraFiles'
    | 'fileAssociations'
  > {
  files?: ResolvedFrontronBuildFilePattern[]
  extraResources?: ResolvedFrontronBuildFilePattern[]
  extraFiles?: ResolvedFrontronBuildFilePattern[]
  fileAssociations?: ResolvedFrontronBuildFileAssociation[]
  windows?: ResolvedFrontronBuildWindowsConfig
  nsis?: ResolvedFrontronBuildNsisConfig
  mac?: ResolvedFrontronBuildMacConfig
  linux?: ResolvedFrontronBuildLinuxConfig
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
  build?: FrontronBuildConfig
  deepLinks?: FrontronDeepLinksConfig
  updates?: FrontronUpdatesConfig
  security?: FrontronSecurityConfig
  windows?: FrontronWindowsConfig
  bridge?: FrontronBridgeConfig
  tray?: FrontronTrayConfig
  menu?: FrontronMenuConfig
  hooks?: FrontronHooksConfig
  rust?: boolean | FrontronRustConfig
}

export interface ResolvedFrontronConfig
  extends Omit<FrontronConfig, 'rust' | 'build' | 'updates' | 'deepLinks' | 'security'> {
  build?: ResolvedFrontronBuildConfig
  deepLinks?: ResolvedFrontronDeepLinksConfig
  updates?: ResolvedFrontronUpdatesConfig
  security?: ResolvedFrontronSecurityConfig
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
