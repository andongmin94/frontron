import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import { MANIFEST_PATH } from '../src/init/manifest'
import { loadCreateFrontronTemplate } from '../src/init/runtime/create-frontron-template'
import * as fixtures from './helpers/frontron-cli-fixtures'

function createTemplateFixture() {
  const root = fixtures.createTempProject()
  const packageRoot = join(root, 'create-frontron-fixture')
  const templateDir = join(packageRoot, 'template')
  const { version } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string }

  fixtures.tempDirs.push(root)
  mkdirSync(packageRoot)
  cpSync(new URL('../../create-frontron/template', import.meta.url), templateDir, {
    recursive: true,
  })
  writeFileSync(
    join(packageRoot, 'package.json'),
    `${JSON.stringify({ name: 'create-frontron', version }, null, 2)}\n`,
  )

  return { packageRoot, templateDir }
}

function withTemplate<T>(templateDir: string, run: () => T) {
  const previous = process.env.FRONTRON_CREATE_TEMPLATE_DIR
  process.env.FRONTRON_CREATE_TEMPLATE_DIR = templateDir

  try {
    return run()
  } finally {
    if (previous === undefined) delete process.env.FRONTRON_CREATE_TEMPLATE_DIR
    else process.env.FRONTRON_CREATE_TEMPLATE_DIR = previous
  }
}

describe('frontron init guardrails', () => {
  test('template loading rejects a linked parent of a required source file', () => {
    const { packageRoot, templateDir } = createTemplateFixture()
    const typesDir = join(templateDir, 'src', 'types')
    const linkedTarget = join(packageRoot, 'linked-types')

    renameSync(typesDir, linkedTarget)
    symlinkSync(linkedTarget, typesDir, process.platform === 'win32' ? 'junction' : 'dir')

    expect(() => withTemplate(templateDir, () => loadCreateFrontronTemplate())).toThrow(
      'symbolic',
    )
  })

  test.each([
    ['Electron source directory', ['--desktop-dir', '../outside-electron']],
    ['frontend output directory', ['--out-dir', '../outside-dist']],
  ])('init rejects a project-escaping %s', async (_label, args) => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    expect(await runCli(['init', '--dry-run', ...args], output, { cwd: projectRoot })).toBe(1)
    expect(output.error.mock.calls.flat().join('\n')).toContain('must not contain ".." path segments')
    expect(existsSync(join(projectRoot, MANIFEST_PATH))).toBe(false)
    expect(existsSync(join(projectRoot, 'electron'))).toBe(false)
  })

  test('init rejects a desktop directory whose parent is a link or junction', async () => {
    const projectRoot = fixtures.createTempProject()
    const outsideRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot, outsideRoot)

    symlinkSync(
      outsideRoot,
      join(projectRoot, 'linked-electron'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    const output = fixtures.createOutput()
    expect(
      await runCli(
        ['init', '--dry-run', '--desktop-dir', 'linked-electron'],
        output,
        { cwd: projectRoot },
      ),
    ).toBe(1)
    expect(output.error.mock.calls.flat().join('\n')).toContain('symbolic link or junction')
    expect(existsSync(join(outsideRoot, 'main.ts'))).toBe(false)
  })

  test('init rejects unsupported options before inspecting or writing project files', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const existingPath = join(projectRoot, 'tsconfig.electron.json')
    writeFileSync(existingPath, '{}\n')
    const output = fixtures.createOutput()

    expect(await runCli(['init', '--yes', '--force'], output, { cwd: projectRoot })).toBe(1)
    expect(readFileSync(existingPath, 'utf8')).toBe('{}\n')
    expect(output.error.mock.calls.flat().join('\n')).toContain(
      'Unknown option "--force" for "frontron init"',
    )
  })
})
