// electron-builder 하위의 minimatch 9.x·10.x는 GHSA-g3hv-75wg-m249(>=7.0.0 <11.0.1)에 해당한다.
// 같은 하위 트리의 glob·@electron/asar·dir-compare·filelist는 minimatch 3.x·5.x의 기본 export 함수를
// 호출하므로, 버전 범위가 없는 override로 11.x를 강제하면 이 패키지들이 깨진다.
// 따라서 패키지 매니저마다 취약한 minimatch만 교체하는 가장 좁은 문법을 쓴다.
// 키에 '.'이 들어가면 점 표기법 claim 경로가 깨지므로 범위는 점 없이 적는다.

// npm: electron-builder 하위 트리에서 9~11 메이저만 교체한다.
export const NPM_BUILDER_MINIMATCH_OVERRIDE_KEY = 'minimatch@>=9 <12'

export const NPM_BUILDER_MINIMATCH_OVERRIDE_PATH = `overrides.electron-builder.${NPM_BUILDER_MINIMATCH_OVERRIDE_KEY}`

// pnpm: `a>b`는 직접 의존성에만 적용되므로 취약 버전을 직접 요청하는 부모를 지정한다.
// 버전 선택자를 붙여 부모가 나중에 다른 메이저를 요청하면 override가 적용되지 않게 한다.
export const PNPM_BUILDER_MINIMATCH_OVERRIDE_KEYS = [
  'app-builder-lib>minimatch@>=9 <12',
  '@electron/universal>minimatch@>=9 <12',
] as const

// Yarn Berry: `parent/dependency` resolution은 해당 부모의 직접 의존성만 교체한다.
export const YARN_BUILDER_MINIMATCH_RESOLUTION_KEYS = [
  'app-builder-lib/minimatch',
  '@electron/universal/minimatch',
] as const

export const YARN_BUILDER_MINIMATCH_RESOLUTION_PATHS = YARN_BUILDER_MINIMATCH_RESOLUTION_KEYS.map(
  (key) => `resolutions.${key}`,
)

// Bun 1.3은 중첩·범위 override를 무시하고 최상위 `minimatch`만 지원한다. 최상위 교체는
// minimatch 3.x·5.x 소비자를 깨뜨리므로 Bun에는 override를 추가하지 않고 이유를 알린다.
export const BUN_MINIMATCH_ADVISORY_WARNING =
  'Bun cannot scope dependency overrides, so electron-builder keeps minimatch 9.x/10.x ' +
  'affected by GHSA-g3hv-75wg-m249 (moderate glob-pattern DoS). Frontron adds no override ' +
  'for Bun because a top-level minimatch override breaks glob 7 and @electron/asar. See ' +
  'https://github.com/andongmin94/frontron/blob/main/docs/SUPPORT.md#electron-builder-minimatch-advisory'

// electron-builder 하위에서 minimatch를 직접 요청하는 부모와 취약 범위의 상한(미포함)이다.
export const BUILDER_MINIMATCH_PARENTS = ['app-builder-lib', '@electron/universal'] as const
export const MINIMATCH_FIRST_PATCHED_VERSION = [11, 0, 1] as const

// isMinimatchOverrideKey 함수는 사용자가 이미 지정한 minimatch override 키인지 확인한다.
// npm(`minimatch`, `minimatch@범위`), pnpm(`부모>minimatch`), Yarn(`부모/minimatch`) 형식을 모두 본다.
export function isMinimatchOverrideKey(key: string) {
  return /(^|[>/])minimatch(@|$)/u.test(key)
}
