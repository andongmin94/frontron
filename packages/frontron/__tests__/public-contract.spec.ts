import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const repoRoot = dirname(dirname(dirname(fileURLToPath(new URL('../package.json', import.meta.url)))))

function listFilesRecursive(rootDir: string): string[] {
  const entries = readdirSync(rootDir)
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = join(rootDir, entry)
    const entryStat = statSync(fullPath)

    if (entryStat.isDirectory()) {
      files.push(...listFilesRecursive(fullPath))
      continue
    }

    files.push(fullPath)
  }

  return files
}

test('main onboarding docs keep the renderer API modern-only', () => {
  const onboardingFiles = [
    join(repoRoot, 'docs', 'index.md'),
    join(repoRoot, 'docs', 'guide', 'index.md'),
    join(repoRoot, 'packages', 'create-frontron', 'README.md'),
    join(repoRoot, 'packages', 'create-frontron', 'template', 'README.md'),
  ]
  const bannedPatterns = ['window.electron', 'src/electron']

  for (const filePath of onboardingFiles) {
    const source = readFileSync(filePath, 'utf8')

    for (const bannedPattern of bannedPatterns) {
      expect(source).not.toContain(bannedPattern)
    }
  }
})

test('public docs keep root frontron.config.ts and canonical app scripts as the contract', () => {
  const configReferenceFiles = [
    join(repoRoot, 'docs', 'guide', 'config.md'),
    join(repoRoot, 'docs', 'guide', 'customize-app.md'),
    join(repoRoot, 'docs', 'guide', 'run-development.md'),
    join(repoRoot, 'docs', 'guide', 'troubleshooting.md'),
    join(repoRoot, 'docs', 'ko', 'guide', 'config.md'),
    join(repoRoot, 'docs', 'ko', 'guide', 'customize-app.md'),
    join(repoRoot, 'docs', 'ko', 'guide', 'run-development.md'),
    join(repoRoot, 'docs', 'ko', 'guide', 'troubleshooting.md'),
  ]

  for (const filePath of configReferenceFiles) {
    const source = readFileSync(filePath, 'utf8')

    expect(source).toContain('frontron.config.ts')
    expect(source).not.toContain('frontron/config.ts')
  }

  const configGuideFiles = [
    join(repoRoot, 'docs', 'guide', 'config.md'),
    join(repoRoot, 'docs', 'ko', 'guide', 'config.md'),
  ]

  for (const filePath of configGuideFiles) {
    const source = readFileSync(filePath, 'utf8')

    expect(source).toContain('"app:dev": "frontron dev"')
    expect(source).toContain('"app:build": "frontron build"')
    expect(source).not.toContain('"app": "npm run app:dev"')
    expect(source).not.toContain('"build": "npm run app:build"')
  }
})

test('starter template files do not reintroduce legacy renderer or runtime paths', () => {
  const templateRoot = join(repoRoot, 'packages', 'create-frontron', 'template')
  const templateFiles = listFilesRecursive(templateRoot)
  const bannedPatterns = ['window.electron', 'src/electron']

  for (const filePath of templateFiles) {
    const source = readFileSync(filePath, 'utf8')

    for (const bannedPattern of bannedPatterns) {
      expect(source).not.toContain(bannedPattern)
    }
  }
})

test('framework source no longer contains the removed legacy adapter path', () => {
  const sourceFiles = [
    join(repoRoot, 'packages', 'frontron', 'src', 'client.ts'),
    join(repoRoot, 'packages', 'frontron', 'src', 'runtime', 'preload.ts'),
  ]
  const bannedPatterns = ['window.electron', "exposeInMainWorld('electron'", 'createLegacyElectronApi']

  for (const filePath of sourceFiles) {
    const source = readFileSync(filePath, 'utf8')

    for (const bannedPattern of bannedPatterns) {
      expect(source).not.toContain(bannedPattern)
    }
  }
})
