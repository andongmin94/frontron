import { join } from 'node:path'
import fs from 'fs-extra'
import { expect, test } from 'vitest'

const repoRoot = join(__dirname, '..', '..')

test('starter-facing docs and template keep the template-owned Electron contract', () => {
  const rootReadme = fs.readFileSync(join(repoRoot, 'README.md'), 'utf-8')
  const starterReadme = fs.readFileSync(join(repoRoot, 'create-frontron', 'README.md'), 'utf-8')
  const templateReadme = fs.readFileSync(
    join(repoRoot, 'create-frontron', 'template', 'README.md'),
    'utf-8',
  )
  const frameworkSpec = fs.readFileSync(join(repoRoot, 'specs', 'framework-first.md'), 'utf-8')

  for (const source of [rootReadme, starterReadme, templateReadme, frameworkSpec]) {
    expect(source).toContain('src/electron')
    expect(source).toContain('window.electron')
  }
})

test('retrofit docs describe frontron as a placeholder/init shell', () => {
  const frontronReadme = fs.readFileSync(join(repoRoot, 'frontron', 'README.md'), 'utf-8')
  const frameworkSpec = fs.readFileSync(join(repoRoot, 'specs', 'framework-first.md'), 'utf-8')
  const retrofitSpec = fs.readFileSync(join(repoRoot, 'specs', 'init-retrofit-v1.md'), 'utf-8')

  for (const source of [frontronReadme, frameworkSpec]) {
    expect(source).toMatch(/placeholder|transitional/i)
    expect(source).toContain('frontron init')
  }

  expect(retrofitSpec).toContain('frontron init')
  expect(retrofitSpec).toMatch(/retrofit|existing web frontend|starter-derived/i)
})
