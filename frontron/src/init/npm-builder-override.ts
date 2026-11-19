// electron-builder 하위의 minimatch 9.x·10.x는 GHSA-g3hv-75wg-m249(>=7.0.0 <11.0.1)에 해당한다.
// 같은 하위 트리의 glob·@electron/asar·dir-compare·filelist는 minimatch 3.x·5.x의 기본 export 함수를
// 호출하므로, 버전 범위가 없는 override로 11.x를 강제하면 이 패키지들이 깨진다.
// 따라서 override 키에 버전 범위를 붙여 취약한 메이저(9~11)만 교체한다.
// 키에 '.'이 들어가면 점 표기법 claim 경로가 깨지므로 범위는 점 없이 적는다.
export const NPM_BUILDER_MINIMATCH_OVERRIDE_KEY = 'minimatch@>=9 <12'

export const NPM_BUILDER_MINIMATCH_OVERRIDE_PATH = `overrides.electron-builder.${NPM_BUILDER_MINIMATCH_OVERRIDE_KEY}`

// isMinimatchOverrideKey 함수는 사용자가 이미 지정한 minimatch override 키인지 확인한다.
export function isMinimatchOverrideKey(key: string) {
  return key === 'minimatch' || key.startsWith('minimatch@')
}
