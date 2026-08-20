import { readFileSync, writeFileSync } from 'node:fs'

function updateFile(path, transform) {
  const before = readFileSync(path, 'utf8')
  const after = transform(before)

  if (after === before) {
    throw new Error(`No migration changes were produced for ${path}`)
  }

  writeFileSync(path, after)
}

function replaceOnce(source, before, after, label) {
  const firstIndex = source.indexOf(before)

  if (firstIndex === -1) {
    throw new Error(`Missing migration target: ${label}`)
  }

  if (source.indexOf(before, firstIndex + before.length) !== -1) {
    throw new Error(`Migration target is ambiguous: ${label}`)
  }

  return `${source.slice(0, firstIndex)}${after}${source.slice(firstIndex + before.length)}`
}

updateFile('frontron/__tests__/adapter-init.spec.ts', (source) => {
  const before = "packageJson.scripts['frontron:package']"
  const matches = source.split(before).length - 1

  if (matches !== 3) {
    throw new Error(`Expected 3 adapter package-script assertions, found ${matches}`)
  }

  return source.split(before).join("packageJson.scripts['frontron:build']")
})

updateFile('frontron/__tests__/init-core.spec.ts', (source) => {
  let result = source

  result = replaceOnce(
    result,
    `    expect(packageJson.scripts['frontron:build']).not.toContain('electron-builder')
    expect(packageJson.scripts['frontron:package']).toContain('vite build')
    expect(packageJson.scripts['frontron:package']).toContain('electron-builder')
    expect(packageJson.scripts['frontron:package']).not.toContain('./node_modules/electron-builder')
    expect(packageJson.scripts['frontron:package']).toContain('--publish never')`,
    `    expect(packageJson.scripts['frontron:build']).toContain('electron-builder')
    expect(packageJson.scripts['frontron:build']).not.toContain('./node_modules/electron-builder')
    expect(packageJson.scripts['frontron:build']).toContain('--publish never')
    expect(packageJson.scripts).not.toHaveProperty('frontron:package')`,
    'default build assertions',
  )

  result = replaceOnce(
    result,
    `    expect(combined).toContain('3. Run "npm run frontron:build" to prepare the desktop build.')
    expect(combined).toContain(
      '4. Run "npm run frontron:package" to create a packaged build when you are ready to distribute.',
    )`,
    `    expect(combined).toContain(
      '3. Run "npm run frontron:build" to build and package the desktop app.',
    )`,
    'default next steps',
  )

  result = replaceOnce(
    result,
    `    expect(manifest.scripts).toEqual(['frontron:dev', 'frontron:build', 'frontron:package'])`,
    `    expect(manifest.scripts).toEqual(['frontron:dev', 'frontron:build'])`,
    'manifest script list',
  )

  result = replaceOnce(
    result,
    `    expect(manifest.scriptCommands['frontron:package']).toContain('electron-builder')`,
    `    expect(manifest.scriptCommands['frontron:build']).toContain('electron-builder')`,
    'manifest build command',
  )

  result = replaceOnce(
    result,
    `    expect(combined).toContain('+ scripts.frontron:package')
`,
    '',
    'dry-run package script assertion',
  )

  result = replaceOnce(
    result,
    `        '--package-script=desktop:package',
`,
    '',
    'removed package option',
  )

  result = replaceOnce(
    result,
    `        'desktop:build',
        'desktop:package',
        'dist-web',`,
    `        'desktop:build',
        'dist-web',`,
    'interactive custom script answers',
  )

  result = replaceOnce(
    result,
    `    expect(packageJson.scripts['desktop:build']).not.toContain('electron-builder')
    expect(packageJson.scripts['desktop:package']).toContain('electron-builder')`,
    `    expect(packageJson.scripts['desktop:build']).toContain('electron-builder')
    expect(packageJson.scripts).not.toHaveProperty('desktop:package')`,
    'interactive custom build assertions',
  )

  result = replaceOnce(
    result,
    `      'const quitAppChannel = "app:quit"',`,
    `      'const openTextFileChannel = "file:open-text"',`,
    'native IPC contract',
  )

  result = replaceOnce(
    result,
    `      'frontron:build',
      'desktop:build',
      'frontron:package',
      'desktop:package',
      'dist',`,
    `      'frontron:build',
      'desktop:build',
      'dist',`,
    'script collision prompt answers',
  )

  result = replaceOnce(
    result,
    `    expect(packageJson.scripts['desktop:build']).not.toContain('electron-builder')
    expect(packageJson.scripts['desktop:package']).toContain('electron-builder')`,
    `    expect(packageJson.scripts['desktop:build']).toContain('electron-builder')
    expect(packageJson.scripts).not.toHaveProperty('desktop:package')`,
    'script collision assertions',
  )

  result = replaceOnce(
    result,
    `    expect(packageJson.scripts['frontron:package:electron']).toContain('electron-builder')`,
    `    expect(packageJson.scripts['frontron:build:electron']).toContain('electron-builder')`,
    'automatic fallback build assertion',
  )

  result = replaceOnce(
    result,
    `    expect(combined).toContain(
      '3. Run "npm run frontron:build:electron" to prepare the desktop build.',
    )
    expect(combined).toContain(
      '4. Run "npm run frontron:package:electron" to create a packaged build when you are ready to distribute.',
    )`,
    `    expect(combined).toContain(
      '3. Run "npm run frontron:build:electron" to build and package the desktop app.',
    )`,
    'fallback next steps',
  )

  return result
})

updateFile('frontron/__tests__/manifest.spec.ts', (source) =>
  replaceOnce(source, 'expect(manifest.schemaVersion).toBe(2)', 'expect(manifest.schemaVersion).toBe(3)', 'manifest schema'),
)

updateFile('frontron/__tests__/update.spec.ts', (source) =>
  replaceOnce(
    source,
    `      '--package-script',
      'desktop:package',
`,
    '',
    'update package option',
  ),
)
