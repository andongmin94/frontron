import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import { isRangeAffected } from '../src/doctor/minimatch-advisory'
import * as fixtures from './helpers/frontron-cli-fixtures'

function setPackageManager(projectRoot: string, packageManager: string) {
  const packageJsonPath = join(projectRoot, 'package.json')
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  packageJson.packageManager = packageManager
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
}

// 실제 설치 없이 electron-builder 하위 부모가 요청하는 minimatch 범위만 흉내 낸다.
function installParent(projectRoot: string, name: string, minimatch: string) {
  const directory = join(projectRoot, 'node_modules', name)
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, 'package.json'),
    `${JSON.stringify({ name, version: '1.0.0', dependencies: { minimatch } })}\n`,
  )
}

async function runDoctor(projectRoot: string) {
  const output = fixtures.createOutput()
  await runCli(['doctor'], output, { cwd: projectRoot })
  return output.info.mock.calls.flat().join('\n')
}

describe('electron-builder minimatch advisory', () => {
  test.each([
    ['^10.2.5', true],
    ['^9.0.3', true],
    ['~11.0.0', true],
    ['>=7 <11', true],
    ['^11.0.1', false],
    ['^11.0.8', false],
    ['^12.0.0', false],
    ['^3.1.1', true],
  ])('treats %s as affected=%s by its lower bound', (range, affected) => {
    expect(isRangeAffected(range)).toBe(affected)
  })

  test('doctor reports whether the managed override is still needed', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    installParent(projectRoot, 'app-builder-lib', '^10.2.5')
    installParent(projectRoot, '@electron/universal', '^9.0.3')
    expect(await runDoctor(projectRoot)).toContain(
      'electron-builder minimatch override still applies (app-builder-lib ^10.2.5, @electron/universal ^9.0.3)',
    )

    installParent(projectRoot, 'app-builder-lib', '^11.0.8')
    installParent(projectRoot, '@electron/universal', '^11.0.8')
    expect(await runDoctor(projectRoot)).toContain(
      'the Frontron-managed override is redundant but harmless',
    )
  })

  test('doctor stays quiet about the override before dependencies are installed', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const report = await runDoctor(projectRoot)
    expect(report).not.toContain('override still applies')
    expect(report).not.toContain('override is redundant')
  })

  test('init and doctor warn Bun projects that the advisory is not mitigated', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setPackageManager(projectRoot, 'bun@1.3.14')

    const initOutput = fixtures.createOutput()
    expect(await runCli(['init', '--yes'], initOutput, { cwd: projectRoot })).toBe(0)
    expect(initOutput.info.mock.calls.flat().join('\n')).toContain('GHSA-g3hv-75wg-m249')

    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
    expect(packageJson.overrides).toBeUndefined()
    expect(packageJson.resolutions).toBeUndefined()
    expect(await runDoctor(projectRoot)).toContain('Bun cannot scope dependency overrides')
  })
})
