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

test('frontron package docs describe a placeholder/init shell, not a stable runtime contract', () => {
  const placeholderFiles = [
    join(repoRoot, 'README.md'),
    join(repoRoot, 'frontron', 'README.md'),
  ]

  for (const filePath of placeholderFiles) {
    const source = readFileSync(filePath, 'utf8')

    expect(source).toMatch(/placeholder|과도기|transitional|experimental|init shell/i)
  }
})
