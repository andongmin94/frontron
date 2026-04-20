export const FRONTRON_RETROFIT_STATUS = 'experimental-init' as const

export interface FrontronPlaceholderInfo {
  status: typeof FRONTRON_RETROFIT_STATUS
  packageName: 'frontron'
  summary: string
  recommendedStarterCommand: string
  retrofitStatus: string
}

export function getPlaceholderInfo(): FrontronPlaceholderInfo {
  return {
    status: FRONTRON_RETROFIT_STATUS,
    packageName: 'frontron',
    summary:
      '`frontron` now ships an experimental `init` command for existing-project retrofit work.',
    recommendedStarterCommand: 'npm create frontron@latest',
    retrofitStatus:
      '`init` can seed a conservative `minimal` or `starter-like` Electron layer, but `check`, `dev`, and `build` remain placeholder commands and the retrofit flow is still starter-derived.',
  }
}
