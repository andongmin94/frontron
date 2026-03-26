import { join, relative } from 'node:path'
import fs from 'fs-extra'
import { expect, test } from 'vitest'

const repoRoot = join(__dirname, '..', '..', '..')
const starterTemplateDir = join(repoRoot, 'packages', 'create-frontron', 'template')
const manualInstallBaselineFiles = [
  'frontron.config.ts',
  'frontron/bridge/index.ts',
  'frontron/config.ts',
  'frontron/windows/index.ts',
  'package.json',
  'src/App.tsx',
  'src/main.tsx',
  'vite.config.ts',
]

const listFiles = (dir: string): string[] => {
  const files: string[] = []

  const visit = (currentDir: string) => {
    for (const entry of fs.readdirSync(currentDir)) {
      const fullPath = join(currentDir, entry)
      const stat = fs.statSync(fullPath)

      if (stat.isDirectory()) {
        visit(fullPath)
        continue
      }

      files.push(relative(dir, fullPath).replace(/\\/g, '/'))
    }
  }

  visit(dir)

  return files.sort()
}

test('starter template keeps the manual-install baseline contract', () => {
  const starterFiles = listFiles(starterTemplateDir)

  expect(starterFiles.length).toBeGreaterThanOrEqual(manualInstallBaselineFiles.length)

  for (const file of manualInstallBaselineFiles) {
    expect(starterFiles).toContain(file)
  }
})

test('starter template declares canonical app scripts and config entrypoints', () => {
  const pkg = fs.readJsonSync(join(starterTemplateDir, 'package.json'))
  const rootConfig = fs.readFileSync(
    join(starterTemplateDir, 'frontron.config.ts'),
    'utf-8',
  )
  const appConfig = fs.readFileSync(
    join(starterTemplateDir, 'frontron', 'config.ts'),
    'utf-8',
  )

  expect(pkg.scripts['app:dev']).toBe('frontron dev')
  expect(pkg.scripts['app:build']).toBe('frontron build')
  expect(rootConfig).toContain("export { default } from './frontron/config'")
  expect(appConfig).toContain("import { defineConfig } from 'frontron'")
  expect(appConfig).toContain('windows')
  expect(appConfig).toContain('bridge')
})

test('docs and package readmes declare the framework-first contract as the target model', () => {
  const rootReadme = fs.readFileSync(join(repoRoot, 'README.md'), 'utf-8')
  const frontronReadme = fs.readFileSync(
    join(repoRoot, 'packages', 'frontron', 'README.md'),
    'utf-8',
  )
  const starterReadme = fs.readFileSync(
    join(repoRoot, 'packages', 'create-frontron', 'README.md'),
    'utf-8',
  )
  const docsHome = fs.readFileSync(join(repoRoot, 'docs', 'index.md'), 'utf-8')
  const docsGuideIndex = fs.readFileSync(
    join(repoRoot, 'docs', 'guide', 'index.md'),
    'utf-8',
  )
  const docsSidebar = fs.readFileSync(
    join(repoRoot, 'docs', '.vitepress', 'config.ts'),
    'utf-8',
  )

  expect(rootReadme).toContain('frontron.config.ts')
  expect(frontronReadme).toContain('frontron dev')
  expect(starterReadme).toContain('starter generator')
  expect(docsHome).toContain('framework-first')
  expect(docsGuideIndex).toContain('Quick Start')
  expect(docsSidebar).toContain('Official Contract')
})
