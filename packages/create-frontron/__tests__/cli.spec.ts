import { join } from 'node:path'

import type { SyncOptions } from 'execa'
import { execaCommandSync } from 'execa'
import fs from 'fs-extra'
import { afterEach, beforeAll, expect, test } from 'vitest'

const CLI_PATH = join(__dirname, '..')

const projectName = 'test-app'
const genPath = join(__dirname, projectName)

const run = (
  args: string[],
  options: SyncOptions = {},
): ReturnType<typeof execaCommandSync> => {
  return execaCommandSync(`node ${CLI_PATH} ${args.join(' ')}`, options)
}

const createNonEmptyDir = () => {
  fs.mkdirpSync(genPath)
  const pkgJson = join(genPath, 'package.json')
  fs.writeFileSync(pkgJson, '{ "foo": "bar" }')
}

const reactTemplateFiles = fs
  .readdirSync(join(CLI_PATH, 'template-react'))
  .map((filePath: string) => (filePath === '_gitignore' ? '.gitignore' : filePath))
  .sort()

beforeAll(() => fs.remove(genPath))
afterEach(() => fs.remove(genPath))

test('prompts for the project name if none supplied', () => {
  const { stdout } = run([])
  expect(stdout).toContain('Project name:')
})

test('asks to overwrite non-empty target directory', () => {
  createNonEmptyDir()
  const { stdout } = run([projectName], { cwd: __dirname })
  expect(stdout).toContain(`Target directory "${projectName}" is not empty.`)
})

test('asks to overwrite non-empty current directory', () => {
  createNonEmptyDir()
  const { stdout } = run(['.'], { cwd: genPath })
  expect(stdout).toContain('Current directory is not empty.')
})

test('scaffolds react template by default', () => {
  const { stdout } = run([projectName], {
    cwd: __dirname,
  })
  const generatedFiles = fs.readdirSync(genPath).sort()

  expect(stdout).toContain(`Scaffolding project in ${genPath}`)
  expect(stdout).not.toContain('Select a framework:')
  expect(reactTemplateFiles).toEqual(generatedFiles)
})

test('scaffolds react template with --template react', () => {
  const { stdout } = run([projectName, '--template', 'react'], {
    cwd: __dirname,
  })
  const generatedFiles = fs.readdirSync(genPath).sort()

  expect(stdout).toContain(`Scaffolding project in ${genPath}`)
  expect(reactTemplateFiles).toEqual(generatedFiles)
})

test('falls back to react on invalid --template value', () => {
  const { stdout } = run([projectName, '--template', 'unknown'], {
    cwd: __dirname,
  })
  const generatedFiles = fs.readdirSync(genPath).sort()

  expect(stdout).toContain('template is not available yet. Falling back to "react".')
  expect(reactTemplateFiles).toEqual(generatedFiles)
})

test('works with the -t alias', () => {
  const { stdout } = run([projectName, '-t', 'react'], {
    cwd: __dirname,
  })
  const generatedFiles = fs.readdirSync(genPath).sort()

  expect(stdout).toContain(`Scaffolding project in ${genPath}`)
  expect(reactTemplateFiles).toEqual(generatedFiles)
})

test('accepts command line override for --overwrite', () => {
  createNonEmptyDir()
  const { stdout } = run(['.', '--overwrite', 'ignore'], { cwd: genPath })
  expect(stdout).not.toContain('Current directory is not empty.')
})