import { describe, expect, test } from 'vitest'

import {
  inferHost,
  inferOutDirFromScript,
  inferPort,
  inferViteConfigPathFromScript,
} from '../src/init/detect'
import type { PackageJson } from '../src/init/shared'

// packageWithScript 함수는 명령 추론 테스트에 필요한 최소 package.json을 만든다.
function packageWithScript(name: string, command: string): PackageJson {
  return {
    scripts: {
      [name]: command,
    },
  }
}

describe('script command detection', () => {
  test('preserves Windows backslashes in quoted Vite config paths', () => {
    const packageJson = packageWithScript(
      'build',
      String.raw`vite build --config "configs\desktop\vite.config.ts"`,
    )

    expect(inferViteConfigPathFromScript(packageJson, 'build')).toBe(
      'configs/desktop/vite.config.ts',
    )
  })

  test('reads Vite output options only from the Vite build segment', () => {
    const packageJson = packageWithScript(
      'build',
      'node prepare.mjs --outDir ignored && vite build --outDir desktop-dist && node report.mjs --outDir ignored-too',
    )

    expect(inferOutDirFromScript(packageJson, 'build')).toBe('desktop-dist')
  })

  test('does not borrow port or host flags from a later shell segment', () => {
    const packageJson = packageWithScript(
      'dev',
      'vite && node report.mjs --port 9999 --host remote.example.test',
    )

    expect(inferPort(packageJson, 'dev')).toBeNull()
    expect(inferHost(packageJson, 'dev')).toBeNull()
  })
})
