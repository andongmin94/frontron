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

  expect(rootReadme).toContain('npm create frontron@latest')
  expect(rootReadme).toContain('create-frontron')

  for (const source of [rootReadme, starterReadme, templateReadme]) {
    expect(source).toContain('src/electron')
    expect(source).toContain('window.electron')
  }
})

test('retrofit docs describe frontron as the init-focused CLI for existing projects', () => {
  const rootReadme = fs.readFileSync(join(repoRoot, 'README.md'), 'utf-8')
  const frontronReadme = fs.readFileSync(join(repoRoot, 'frontron', 'README.md'), 'utf-8')

  for (const source of [rootReadme, frontronReadme]) {
    expect(source).toContain('frontron init')
    expect(source).not.toMatch(/placeholder|transitional/i)
  }

  expect(rootReadme).toMatch(/existing web frontend|existing web project/i)
  expect(rootReadme).toContain('app-owned Electron layer')
  expect(frontronReadme).toMatch(/existing web frontend|existing web project/i)
  expect(frontronReadme).toContain('app-owned Electron layer')
})
