import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, test } from 'vitest'
import { runCli } from '../src/cli'
import { loadCreateFrontronTemplate } from '../src/init/runtime/create-frontron-template'
import * as fixtures from './helpers/frontron-cli-fixtures'

function project(build?: Record<string, unknown>) {
  const root = fixtures.createTempProject()
  fixtures.tempDirs.push(root)
  const file = join(root, 'package.json')
  const original = JSON.parse(readFileSync(file, 'utf8'))
  if (build) original.build = build
  writeFileSync(file, JSON.stringify(original, null, 2) + '\n')
  return { root, file, original }
}

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'))

async function command(root: string, args: string[]) {
  const output = fixtures.createOutput()
  const code = await runCli(args, output, { cwd: root })
  expect(code, output.error.mock.calls.flat().join('\n')).toBe(0)
  return output
}

test('native icons keep their binary content and package claims through init, update and clean', async () => {
  const { root, file, original } = project()
  const before = readFileSync(file, 'utf8')
  const icons = ['icon.png', 'icon.ico']
  const output = await command(root, ['init', '--dry-run', '--desktop-dir', 'desktop'])
  expect(output.info.mock.calls.flat().join('\n')).toContain('build.icon')
  expect(readFileSync(file, 'utf8')).toBe(before)
  for (const name of icons) expect(existsSync(join(root, 'desktop', name))).toBe(false)
  await command(root, ['init', '--yes', '--desktop-dir', 'desktop'])
  expect(readJson(file).build.icon).toBe('desktop/icon.png')
  expect(readJson(file).build.win.icon).toBe('desktop/icon.ico')
  const expected = loadCreateFrontronTemplate().electronFiles
  const manifest = readJson(join(root, '.frontron', 'manifest.json'))
  for (const name of icons) {
    expect(readFileSync(join(root, 'desktop', name))).toEqual(expected.get(name))
    expect(manifest.createdFiles).toContain(`desktop/${name}`)
    expect(manifest.fileHashes[`desktop/${name}`]).toMatch(/^[a-f0-9]{64}$/)
  }
  expect(manifest.packageJsonClaims).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: 'build.icon', value: 'desktop/icon.png', previous: { state: 'missing' } }),
    expect.objectContaining({ path: 'build.win.icon', value: 'desktop/icon.ico', previous: { state: 'missing' } }),
  ]))
  await command(root, ['update', '--yes'])
  expect(readJson(file).build.icon).toBe('desktop/icon.png')
  expect(readJson(file).build.win.icon).toBe('desktop/icon.ico')
  for (const name of icons) {
    expect(readFileSync(join(root, 'desktop', name))).toEqual(expected.get(name))
  }
  await command(root, ['clean', '--yes'])
  for (const name of icons) expect(existsSync(join(root, 'desktop', name))).toBe(false)
  expect(readJson(file).build?.icon).toBeUndefined()
  expect(readJson(file).build?.win?.icon).toBeUndefined()
  expect(readJson(file).scripts).toEqual(original.scripts)
})

test.each(['branding/custom.svg', null])('preserves the explicit icon setting %s', async (icon) => {
  const { root, file } = project({ icon })
  await command(root, ['init', '--yes'])
  await command(root, ['update', '--yes'])
  expect(readJson(file).build.icon).toBe(icon)
  const manifest = readJson(join(root, '.frontron', 'manifest.json'))
  expect(manifest.packageJsonClaims.some((claim: { path: string }) => claim.path === 'build.icon')).toBe(false)
  await command(root, ['clean', '--yes'])
  expect(readJson(file).build.icon).toBe(icon)
})

test('preserves platform-specific icons alongside the generated default', async () => {
  const win = { icon: 'branding/windows.ico', target: ['msi'] }
  const { root, file } = project({ win })
  await command(root, ['init', '--yes'])
  expect(readJson(file).build.win).toEqual(win)
  await command(root, ['update', '--yes'])
  await command(root, ['clean', '--yes'])
  expect(readJson(file).build.win).toEqual(win)
})

test.each([
  ['build', 'icon.svg'],
  ['build', 'icon.ico'],
  ['.', 'icon.png'],
  ['branding', 'icon.svg'],
])('keeps auto-discovered %s/%s under user ownership', async (resources, name) => {
  const build = resources === 'branding' ? { directories: { buildResources: resources } } : undefined
  const { root, file } = project(build)
  const customIcon = join(root, resources, name)
  mkdirSync(dirname(customIcon), { recursive: true })
  writeFileSync(customIcon, 'user-owned icon bytes\n')
  await command(root, ['init', '--yes'])
  expect(readJson(file).build.icon).toBeUndefined()
  await command(root, ['update', '--yes'])
  await command(root, ['clean', '--yes'])
  expect(readFileSync(customIcon, 'utf8')).toBe('user-owned icon bytes\n')
  expect(readJson(file).build?.icon).toBeUndefined()
})

test.each(['icon.png', 'icon.ico'])('protects an edited managed binary %s', async (name) => {
  const { root } = project()
  await command(root, ['init', '--yes'])
  const icon = join(root, 'electron', name)
  const edited = Buffer.from(readFileSync(icon))
  edited[edited.length - 1] ^= 0xff
  writeFileSync(icon, edited)
  const output = fixtures.createOutput()
  expect(await runCli(['update', '--yes'], output, { cwd: root })).toBe(1)
  expect(output.error.mock.calls.flat().join('\n')).toContain(`electron/${name}`)
  expect(readFileSync(icon)).toEqual(edited)
  expect(await runCli(['clean', '--yes'], output, { cwd: root })).toBe(1)
  expect(readFileSync(icon)).toEqual(edited)
})
