import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const repoRoot = dirname(dirname(fileURLToPath(new URL('../package.json', import.meta.url))))

test('starter onboarding docs describe the template-owned Electron structure', () => {
  const onboardingFiles = [
    join(repoRoot, 'README.md'),
    join(repoRoot, 'create-frontron', 'README.md'),
    join(repoRoot, 'create-frontron', 'template', 'README.md'),
  ]

  for (const filePath of onboardingFiles) {
    const source = readFileSync(filePath, 'utf8')

    expect(source).toContain('src/electron')
    expect(source).toContain('window.electron')
  }
})

test('frontron package docs position init as the active retrofit command', () => {
  const source = readFileSync(join(repoRoot, 'frontron', 'README.md'), 'utf8')

  expect(source).toContain('frontron init')
  expect(source).toContain('active command')
  expect(source).toContain('existing web frontend')
  expect(source).toContain('app-owned Electron layer')
  expect(source).toContain('create-frontron')
  expect(source).toContain('next-export')
  expect(source).toContain('next-standalone')
  expect(source).toContain('nuxt-node-server')
  expect(source).toContain('remix-node-server')
  expect(source).toContain('sveltekit-static')
  expect(source).toContain('sveltekit-node')
  expect(source).toContain('generic-node-server')
})
