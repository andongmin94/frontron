import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { SyncOptions } from 'execa'
import { execaCommandSync } from 'execa'
import fs from 'fs-extra'
import { afterEach, beforeAll, expect, test } from 'vitest'

const CLI_PATH = join(__dirname, '..')

const projectName = 'test-app'
const genPath = join(__dirname, projectName)
const nestedRoot = join(__dirname, 'nested-fixture')

const run = (args: string[], options: SyncOptions = {}): ReturnType<typeof execaCommandSync> => {
  return execaCommandSync(`node ${CLI_PATH} ${args.join(' ')}`, options)
}

// Helper to create a non-empty directory
const createNonEmptyDir = () => {
  // Create the temporary directory
  fs.mkdirpSync(genPath)

  // Create a package.json file
  const pkgJson = join(genPath, 'package.json')
  fs.writeFileSync(pkgJson, '{ "foo": "bar" }')
}

// React starter template
const reactTemplateFiles = fs
  .readdirSync(join(CLI_PATH, 'template'))
  .filter(
    (filePath: string) =>
      !['dist', 'node_modules', 'output', '.git', '.npmignore'].includes(filePath),
  )
  // _gitignore is renamed to .gitignore
  .map((filePath: string) => (filePath === '_gitignore' ? '.gitignore' : filePath))
  .sort()

function removeGeneratedProject() {
  for (const targetPath of [genPath, nestedRoot]) {
    rmSync(targetPath, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    })
  }
}

beforeAll(removeGeneratedProject)
afterEach(removeGeneratedProject)

test('prompts for the project name if none supplied', () => {
  const { stdout } = run([])
  expect(stdout).toContain('Project name:')
})

test('prints help without prompting', () => {
  const { stdout } = run(['--help'])

  expect(stdout).toContain('Usage: create-frontron [project-name] [options]')
  expect(stdout).toContain('--overwrite <yes|no|ignore>')
  expect(stdout).toContain('Defaults to "desktop-app"')
  expect(stdout).not.toContain('Project name:')
})

test('asks to overwrite non-empty target directory', () => {
  createNonEmptyDir()
  const { stdout } = run([projectName], { cwd: __dirname })
  expect(stdout).toContain(`Target directory "${projectName}" is not empty.`)
})

test('asks to overwrite non-empty current directory', () => {
  createNonEmptyDir()
  const { stdout } = run(['.'], { cwd: genPath })
  expect(stdout).toContain(`Current directory is not empty.`)
})

test('successfully scaffolds a project based on the default react starter template', () => {
  const { stdout } = run([projectName], { cwd: __dirname })
  const generatedFiles = fs.readdirSync(genPath).sort()

  // Assertions
  expect(stdout).toContain(`Scaffolding project in ${genPath}`)
  expect(reactTemplateFiles).toEqual(generatedFiles)
})

test('rejects the removed template option', () => {
  expect.assertions(4)

  for (const args of [
    [projectName, '--template', 'react'],
    [projectName, '-t', 'react'],
  ]) {
    try {
      run(args, { cwd: __dirname })
    } catch (error: any) {
      expect(error.exitCode).toBe(1)
      expect(error.stderr).toContain('Template selection has been removed.')
    }
  }
})

test('accepts command line override for --overwrite', () => {
  createNonEmptyDir()
  const { stdout } = run(['.', '--overwrite', 'ignore'], { cwd: genPath })
  expect(stdout).not.toContain(`Current directory is not empty.`)
})

test('rejects an invalid command line override for --overwrite', () => {
  expect(() => run([projectName, '--overwrite', 'typo'], { cwd: __dirname })).toThrow(
    '--overwrite must be one of "yes", "no", or "ignore".',
  )
})

test('uses the final directory name for nested project metadata', () => {
  const nestedProjectPath = join(nestedRoot, 'nested-app')

  run(['nested-fixture/nested-app'], { cwd: __dirname })

  const packageJson = fs.readJsonSync(join(nestedProjectPath, 'package.json'))
  expect(packageJson.name).toBe('nested-app')
  expect(packageJson.productName).toBe('nested-app')
  expect(packageJson.build.productName).toBe('nested-app')
})

test('replace overwrite preserves .git and removes previous project files', () => {
  createNonEmptyDir()
  fs.mkdirpSync(join(genPath, '.git'))
  fs.writeFileSync(join(genPath, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  fs.writeFileSync(join(genPath, 'old.txt'), 'remove me\n')

  run(['.', '--overwrite', 'yes'], { cwd: genPath })

  expect(fs.existsSync(join(genPath, 'old.txt'))).toBe(false)
  expect(fs.readFileSync(join(genPath, '.git', 'HEAD'), 'utf8')).toContain('refs/heads/main')
  expect(fs.existsSync(join(genPath, 'src', 'electron', 'main.ts'))).toBe(true)
})
