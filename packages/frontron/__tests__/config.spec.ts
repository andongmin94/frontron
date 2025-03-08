import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { afterEach, expect, test } from 'vitest'
import { join } from 'node:path'

import { defineConfig, findConfigPath, loadConfig } from '../src/index'
import { createFixtureProject, removeFixtureProject } from './helpers'

const fixtureDirs: string[] = []

afterEach(() => {
  for (const fixtureDir of fixtureDirs.splice(0)) {
    removeFixtureProject(fixtureDir)
  }
})

test('defineConfig returns the provided config object', () => {
  const config = {
    app: {
      name: 'Fixture App',
      id: 'com.example.fixture',
    },
  }

  expect(defineConfig(config)).toBe(config)
})

test('findConfigPath searches upward for frontron.config.ts', () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  const configPath = findConfigPath({
    cwd: join(fixtureDir, 'src', 'nested'),
  })

  expect(configPath).toBe(join(fixtureDir, 'frontron.config.ts'))
})

test('loadConfig resolves root-based paths and extensionless ts imports', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  const loaded = await loadConfig({
    cwd: join(fixtureDir, 'src', 'nested'),
  })

  expect(loaded.rootDir).toBe(fixtureDir)
  expect(loaded.configPath).toBe(join(fixtureDir, 'frontron.config.ts'))
  expect(loaded.config.app.name).toBe('Fixture App')
  expect(loaded.config.app.icon).toBe(join(fixtureDir, 'public', 'icon.png'))
  expect(loaded.config.web?.build?.outDir).toBe(join(fixtureDir, 'dist'))
  expect(loaded.config.build).toBeUndefined()
  expect(loaded.config.windows?.main.route).toBe('/')
  expect(loaded.config.menu?.[0]?.label).toBe('Window')
  expect(loaded.config.tray?.icon).toBe(join(fixtureDir, 'public', 'icon.png'))
  expect(typeof loaded.config.hooks?.beforeDev).toBe('function')
  expect(typeof loaded.config.hooks?.beforeBuild).toBe('string')
  expect(loaded.config.rust?.enabled).toBe(false)
  expect(loaded.config.rust?.bridge?.math?.add.symbol).toBe('frontron_native_add')
  expect(loaded.config.rust?.bridge?.math?.add.args).toEqual(['int', 'int'])
  expect(loaded.config.rust?.bridge?.math?.add.returns).toBe('int')
  expect(loaded.config.rust?.path).toBe(join(fixtureDir, 'frontron', 'rust'))
  expect(loaded.config.rust?.cargoTomlPath).toBe(
    join(fixtureDir, 'frontron', 'rust', 'Cargo.toml'),
  )
  expect(loaded.config.rust?.libRsPath).toBe(
    join(fixtureDir, 'frontron', 'rust', 'src', 'lib.rs'),
  )
})

test('loadConfig accepts the official frontron.config.ts in commonjs projects', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        version: '1.2.3',
        private: true,
      },
      null,
      2,
    ),
  )

  const loaded = await loadConfig({
    cwd: join(fixtureDir, 'src', 'nested'),
  })

  expect(loaded.rootDir).toBe(fixtureDir)
  expect(loaded.configPath).toBe(join(fixtureDir, 'frontron.config.ts'))
  expect(loaded.config.app.name).toBe('Fixture App')
  expect(loaded.config.windows?.main.route).toBe('/')
})

test('loadConfig resolves build output paths and normalizes windows targets', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  build: {',
        "    outputDir: 'release',",
        "    artifactName: '${productName}-${version}-${target}.${ext}',",
        "    windows: { targets: 'portable' },",
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  const loaded = await loadConfig({
    cwd: join(fixtureDir, 'src', 'nested'),
  })

  expect(loaded.config.build?.outputDir).toBe(join(fixtureDir, 'release'))
  expect(loaded.config.build?.artifactName).toBe('${productName}-${version}-${target}.${ext}')
  expect(loaded.config.build?.windows?.targets).toEqual(['portable'])
})

test('loadConfig accepts common app metadata and build publish settings', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource
      .replace(
        "const app: AppMeta = { name: 'Fixture App', id: 'com.example.fixture', icon: 'public/icon.png' }",
        [
          'const app = {',
          "  name: 'Fixture App',",
          "  id: 'com.example.fixture',",
          "  icon: 'public/icon.png',",
          "  description: 'Fixture desktop app',",
          "  author: 'Fixture Team',",
          "  copyright: 'Copyright (c) 2026 Fixture Team',",
          '}',
        ].join('\n'),
      )
      .replace(
        '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
        [
          '  build: {',
          "    outputDir: 'release',",
          "    artifactName: '${productName}-${version}-${target}.${ext}',",
          "    publish: 'onTag',",
          "    windows: { targets: 'portable' },",
          '  },',
          '  windows,',
          '  bridge,',
          '  menu,',
          '  tray,',
          '  hooks,',
        ].join('\n'),
      ),
  )

  const loaded = await loadConfig({
    cwd: join(fixtureDir, 'src', 'nested'),
  })

  expect(loaded.config.app.description).toBe('Fixture desktop app')
  expect(loaded.config.app.author).toBe('Fixture Team')
  expect(loaded.config.app.copyright).toBe('Copyright (c) 2026 Fixture Team')
  expect(loaded.config.build?.outputDir).toBe(join(fixtureDir, 'release'))
  expect(loaded.config.build?.artifactName).toBe('${productName}-${version}-${target}.${ext}')
  expect(loaded.config.build?.publish).toBe('onTag')
  expect(loaded.config.build?.windows?.targets).toEqual(['portable'])
})

test('loadConfig normalizes auto-update defaults for a generic feed', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  updates: {',
        "    url: 'https://updates.example.com/appcast.xml',",
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  const loaded = await loadConfig({
    cwd: join(fixtureDir, 'src', 'nested'),
  })

  expect(loaded.config.updates).toEqual({
    enabled: true,
    provider: 'generic',
    url: 'https://updates.example.com/appcast.xml',
    checkOnLaunch: true,
  })
})

test('loadConfig normalizes explicit security navigation policy defaults', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  security: {',
        "    externalNavigation: 'deny',",
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  const loaded = await loadConfig({
    cwd: join(fixtureDir, 'src', 'nested'),
  })

  expect(loaded.config.security).toEqual({
    externalNavigation: 'deny',
    newWindow: 'openExternal',
  })
})

test('loadConfig allows disabling auto updates without a feed URL', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  updates: {',
        '    enabled: false,',
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  const loaded = await loadConfig({
    cwd: join(fixtureDir, 'src', 'nested'),
  })

  expect(loaded.config.updates).toEqual({
    enabled: false,
    provider: 'generic',
    checkOnLaunch: true,
  })
})

test('loadConfig normalizes deep-link schemes and defaults the registration name', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  deepLinks: {',
        "    schemes: ['Fixture-App', 'fixture-auth'],",
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  const loaded = await loadConfig({
    cwd: join(fixtureDir, 'src', 'nested'),
  })

  expect(loaded.config.deepLinks).toEqual({
    enabled: true,
    schemes: ['fixture-app', 'fixture-auth'],
  })
})

test('loadConfig allows disabling deep links without schemes', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  deepLinks: {',
        '    enabled: false,',
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  const loaded = await loadConfig({
    cwd: join(fixtureDir, 'src', 'nested'),
  })

  expect(loaded.config.deepLinks).toEqual({
    enabled: false,
    schemes: [],
  })
})

test('loadConfig resolves advanced packaging settings and file pattern paths', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  build: {',
        '    asar: false,',
        "    compression: 'maximum',",
        "    files: ['**/*', { from: 'web', to: 'web-copy', filter: ['**/*'] }],",
        "    extraResources: ['public/icon.png', { from: 'public', to: 'assets', filter: '**/*.png' }],",
        "    extraFiles: [{ from: 'public', to: 'public-copy' }],",
        '    fileAssociations: [',
        "      { ext: ['fixture', 'fixturedoc'], name: 'Fixture Document', description: 'Fixture desktop document', icon: 'public/icon.png', role: 'Editor', rank: 'Owner' },",
        "      { ext: 'fixturemime', mimeType: 'application/x-fixture' },",
        '    ],',
        '    windows: {',
        "      targets: 'portable',",
        "      icon: 'public/icon.png',",
        "      publisherName: 'Fixture Team',",
        "      certificateSubjectName: 'Fixture Desktop Signing',",
        '      signAndEditExecutable: false,',
        "      requestedExecutionLevel: 'highestAvailable',",
        "      artifactName: 'fixture-win-${version}.${ext}',",
        '    },',
        '    nsis: {',
        '      oneClick: false,',
        '      perMachine: true,',
        '      allowToChangeInstallationDirectory: true,',
        '      deleteAppDataOnUninstall: true,',
        "      installerIcon: 'public/icon.png',",
        "      uninstallerIcon: 'public/icon.png',",
        '    },',
        '    mac: {',
        "      targets: ['dmg', 'zip'],",
        "      icon: 'public/icon.png',",
        "      category: 'public.app-category.developer-tools',",
        "      identity: 'Developer ID Application: Fixture Team',",
        '      hardenedRuntime: true,',
        '      gatekeeperAssess: false,',
        "      entitlements: 'entitlements.mac.plist',",
        "      entitlementsInherit: 'entitlements.mac.inherit.plist',",
        "      artifactName: 'fixture-mac-${version}.${ext}',",
        '    },',
        '    linux: {',
        "      targets: ['AppImage', 'deb'],",
        "      icon: 'public/icon.png',",
        "      category: 'Development',",
        "      packageCategory: 'devel',",
        "      artifactName: 'fixture-linux-${version}.${ext}',",
        '    },',
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  const loaded = await loadConfig({
    cwd: join(fixtureDir, 'src', 'nested'),
  })

  expect(loaded.config.build?.asar).toBe(false)
  expect(loaded.config.build?.compression).toBe('maximum')
  expect(loaded.config.build?.files).toEqual([
    '**/*',
    {
      from: join(fixtureDir, 'web'),
      to: 'web-copy',
      filter: ['**/*'],
    },
  ])
  expect(loaded.config.build?.extraResources).toEqual([
    join(fixtureDir, 'public', 'icon.png'),
    {
      from: join(fixtureDir, 'public'),
      to: 'assets',
      filter: ['**/*.png'],
    },
  ])
  expect(loaded.config.build?.extraFiles).toEqual([
    {
      from: join(fixtureDir, 'public'),
      to: 'public-copy',
    },
  ])
  expect(loaded.config.build?.fileAssociations).toEqual([
    {
      ext: ['fixture', 'fixturedoc'],
      name: 'Fixture Document',
      description: 'Fixture desktop document',
      icon: join(fixtureDir, 'public', 'icon.png'),
      role: 'Editor',
      rank: 'Owner',
    },
    {
      ext: ['fixturemime'],
      mimeType: 'application/x-fixture',
    },
  ])
  expect(loaded.config.build?.windows?.targets).toEqual(['portable'])
  expect(loaded.config.build?.windows?.icon).toBe(join(fixtureDir, 'public', 'icon.png'))
  expect(loaded.config.build?.windows?.publisherName).toEqual(['Fixture Team'])
  expect(loaded.config.build?.windows?.certificateSubjectName).toBe('Fixture Desktop Signing')
  expect(loaded.config.build?.windows?.signAndEditExecutable).toBe(false)
  expect(loaded.config.build?.windows?.requestedExecutionLevel).toBe('highestAvailable')
  expect(loaded.config.build?.windows?.artifactName).toBe('fixture-win-${version}.${ext}')
  expect(loaded.config.build?.nsis?.oneClick).toBe(false)
  expect(loaded.config.build?.nsis?.perMachine).toBe(true)
  expect(loaded.config.build?.nsis?.allowToChangeInstallationDirectory).toBe(true)
  expect(loaded.config.build?.nsis?.deleteAppDataOnUninstall).toBe(true)
  expect(loaded.config.build?.nsis?.installerIcon).toBe(join(fixtureDir, 'public', 'icon.png'))
  expect(loaded.config.build?.nsis?.uninstallerIcon).toBe(join(fixtureDir, 'public', 'icon.png'))
  expect(loaded.config.build?.mac?.targets).toEqual(['dmg', 'zip'])
  expect(loaded.config.build?.mac?.icon).toBe(join(fixtureDir, 'public', 'icon.png'))
  expect(loaded.config.build?.mac?.category).toBe('public.app-category.developer-tools')
  expect(loaded.config.build?.mac?.identity).toBe('Developer ID Application: Fixture Team')
  expect(loaded.config.build?.mac?.hardenedRuntime).toBe(true)
  expect(loaded.config.build?.mac?.gatekeeperAssess).toBe(false)
  expect(loaded.config.build?.mac?.entitlements).toBe(join(fixtureDir, 'entitlements.mac.plist'))
  expect(loaded.config.build?.mac?.entitlementsInherit).toBe(
    join(fixtureDir, 'entitlements.mac.inherit.plist'),
  )
  expect(loaded.config.build?.mac?.artifactName).toBe('fixture-mac-${version}.${ext}')
  expect(loaded.config.build?.linux?.targets).toEqual(['AppImage', 'deb'])
  expect(loaded.config.build?.linux?.icon).toBe(join(fixtureDir, 'public', 'icon.png'))
  expect(loaded.config.build?.linux?.category).toBe('Development')
  expect(loaded.config.build?.linux?.packageCategory).toBe('devel')
  expect(loaded.config.build?.linux?.artifactName).toBe('fixture-linux-${version}.${ext}')
})

test('loadConfig accepts guarded advanced overrides for builder and windows', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')
  const windowsPath = join(fixtureDir, 'frontron', 'windows', 'index.ts')
  const windowsSource = readFileSync(windowsPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  build: {',
        '    advanced: {',
        '      electronBuilder: {',
        '        compressionLevel: 7,',
        '        directories: {',
        "          buildResources: 'builder-resources',",
        '        },',
        '        win: {',
        '          verifyUpdateCodeSignature: false,',
        '        },',
        '      },',
        '    },',
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  writeFileSync(
    windowsPath,
    windowsSource.replace(
      '    height: 800,',
      [
        '    height: 800,',
        '    advanced: {',
        '      x: 80,',
        '      y: 40,',
        '      movable: false,',
        '    },',
      ].join('\n'),
    ),
  )

  const loaded = await loadConfig({
    cwd: join(fixtureDir, 'src', 'nested'),
  })

  expect(loaded.config.build?.advanced?.electronBuilder).toEqual({
    compressionLevel: 7,
    directories: {
      buildResources: 'builder-resources',
    },
    win: {
      verifyUpdateCodeSignature: false,
    },
  })
  expect(loaded.config.windows?.main.advanced).toEqual({
    x: 80,
    y: 40,
    movable: false,
  })
})

test('loadConfig rejects framework-owned builder advanced overrides', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  build: {',
        '    advanced: {',
        '      electronBuilder: {',
        '        extraMetadata: {',
        "          main: 'custom-main.js',",
        '        },',
        '      },',
        '    },',
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  await expect(
    loadConfig({
      cwd: join(fixtureDir, 'src', 'nested'),
    }),
  ).rejects.toThrow('"build.advanced.electronBuilder" cannot set "extraMetadata.main"')
})

test('loadConfig rejects protocol registration in builder advanced overrides', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  build: {',
        '    advanced: {',
        '      electronBuilder: {',
        '        protocols: [{',
        "          name: 'Bypassed Protocols',",
        "          schemes: ['fixture-bypass'],",
        '        }],',
        '      },',
        '    },',
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  await expect(
    loadConfig({
      cwd: join(fixtureDir, 'src', 'nested'),
    }),
  ).rejects.toThrow('"build.advanced.electronBuilder" cannot set "protocols"')
})

test('loadConfig rejects file associations in builder advanced overrides', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  build: {',
        '    advanced: {',
        '      electronBuilder: {',
        '        fileAssociations: [{',
        "          ext: 'fixture-bypass',",
        '        }],',
        '      },',
        '    },',
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  await expect(
    loadConfig({
      cwd: join(fixtureDir, 'src', 'nested'),
    }),
  ).rejects.toThrow('"build.advanced.electronBuilder" cannot set "fileAssociations"')
})

test('loadConfig validates signing config types', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  build: {',
        '    windows: {',
        '      certificateSubjectName: 42,',
        '    },',
        '    mac: {',
        "      identity: 'Developer ID Application: Fixture Team',",
        "      hardenedRuntime: 'yes',",
        '    },',
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  await expect(
    loadConfig({
      cwd: fixtureDir,
    }),
  ).rejects.toThrow('"build.windows.certificateSubjectName" must be a non-empty string')
})

test('loadConfig validates file association shapes', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  build: {',
        '    fileAssociations: [',
        "      { ext: [], role: 'BrokenRole' },",
        '    ],',
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  await expect(
    loadConfig({
      cwd: fixtureDir,
    }),
  ).rejects.toThrow('"build.fileAssociations"[0].ext must be a non-empty array of strings.')
})

test('loadConfig requires a feed URL when auto updates stay enabled', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  updates: {',
        '    enabled: true,',
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  await expect(
    loadConfig({
      cwd: fixtureDir,
    }),
  ).rejects.toThrow('"updates.url" must be a non-empty string')
})

test('loadConfig validates supported security policies', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  security: {',
        "    externalNavigation: 'browserOnly',",
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  await expect(
    loadConfig({
      cwd: fixtureDir,
    }),
  ).rejects.toThrow('"security.externalNavigation" must be one of')
})

test('loadConfig requires deep-link schemes when deep links stay enabled', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  deepLinks: {',
        '    enabled: true,',
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  await expect(
    loadConfig({
      cwd: fixtureDir,
    }),
  ).rejects.toThrow('"deepLinks.schemes" must be a non-empty array of strings')
})

test('loadConfig validates supported build compression modes', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  build: {',
        "    compression: 'fast',",
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  await expect(
    loadConfig({
      cwd: join(fixtureDir, 'src', 'nested'),
    }),
  ).rejects.toThrow('"build.compression" must be one of')
})

test('loadConfig validates build file pattern arrays', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  build: {',
        '    files: [],',
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  await expect(
    loadConfig({
      cwd: join(fixtureDir, 'src', 'nested'),
    }),
  ).rejects.toThrow('"build.files" must be a non-empty array')
})

test('loadConfig validates Windows requested execution levels', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  build: {',
        "    windows: { requestedExecutionLevel: 'elevated' },",
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  await expect(
    loadConfig({
      cwd: join(fixtureDir, 'src', 'nested'),
    }),
  ).rejects.toThrow('"build.windows.requestedExecutionLevel" must be one of')
})

test('loadConfig validates macOS build targets', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  build: {',
        "    mac: { targets: ['dmg', 'broken-target'] },",
        "    linux: { targets: ['AppImage', 'deb'] },",
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  await expect(
    loadConfig({
      cwd: join(fixtureDir, 'src', 'nested'),
    }),
  ).rejects.toThrow('"build.mac.targets"[1] must be one of')
})

test('loadConfig validates Linux build targets', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  build: {',
        "    mac: { targets: ['dmg', 'zip'] },",
        "    linux: { targets: ['AppImage', 'mystery-target'] },",
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  await expect(
    loadConfig({
      cwd: join(fixtureDir, 'src', 'nested'),
    }),
  ).rejects.toThrow('"build.linux.targets"[1] must be one of')
})

test('loadConfig accepts advanced window options', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const windowsPath = join(fixtureDir, 'frontron', 'windows', 'index.ts')

  writeFileSync(
    windowsPath,
    [
      'const windows = {',
      '  main: {',
      "    route: '/',",
      '    width: 1280,',
      '    height: 800,',
      '    minWidth: 960,',
      '    minHeight: 640,',
      '    maxWidth: 1600,',
      '    maxHeight: 1200,',
      '    show: false,',
      '    center: true,',
      '    fullscreenable: false,',
      '    maximizable: false,',
      '    minimizable: false,',
      '    closable: true,',
      '    alwaysOnTop: true,',
      "    backgroundColor: '#101010',",
      '    transparent: false,',
      '    autoHideMenuBar: true,',
      '    skipTaskbar: false,',
      "    title: 'Fixture Window',",
      "    titleBarStyle: 'hidden',",
      '    zoomFactor: 1.25,',
      '    sandbox: true,',
      '    spellcheck: false,',
      '    webSecurity: false,',
      '  },',
      '}',
      '',
      'export default windows',
      '',
    ].join('\n'),
  )

  const loaded = await loadConfig({
    cwd: join(fixtureDir, 'src', 'nested'),
  })

  expect(loaded.config.windows?.main.minWidth).toBe(960)
  expect(loaded.config.windows?.main.minHeight).toBe(640)
  expect(loaded.config.windows?.main.maxWidth).toBe(1600)
  expect(loaded.config.windows?.main.maxHeight).toBe(1200)
  expect(loaded.config.windows?.main.show).toBe(false)
  expect(loaded.config.windows?.main.center).toBe(true)
  expect(loaded.config.windows?.main.fullscreenable).toBe(false)
  expect(loaded.config.windows?.main.maximizable).toBe(false)
  expect(loaded.config.windows?.main.minimizable).toBe(false)
  expect(loaded.config.windows?.main.closable).toBe(true)
  expect(loaded.config.windows?.main.alwaysOnTop).toBe(true)
  expect(loaded.config.windows?.main.backgroundColor).toBe('#101010')
  expect(loaded.config.windows?.main.transparent).toBe(false)
  expect(loaded.config.windows?.main.autoHideMenuBar).toBe(true)
  expect(loaded.config.windows?.main.skipTaskbar).toBe(false)
  expect(loaded.config.windows?.main.title).toBe('Fixture Window')
  expect(loaded.config.windows?.main.titleBarStyle).toBe('hidden')
  expect(loaded.config.windows?.main.zoomFactor).toBe(1.25)
  expect(loaded.config.windows?.main.sandbox).toBe(true)
  expect(loaded.config.windows?.main.spellcheck).toBe(false)
  expect(loaded.config.windows?.main.webSecurity).toBe(false)
})

test('loadConfig validates window boolean options', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const windowsPath = join(fixtureDir, 'frontron', 'windows', 'index.ts')
  const windowsSource = readFileSync(windowsPath, 'utf8')

  writeFileSync(windowsPath, windowsSource.replace('    height: 800,', "    height: 800,\n    show: 'yes',"))

  await expect(
    loadConfig({
      cwd: join(fixtureDir, 'src', 'nested'),
    }),
  ).rejects.toThrow('"windows.main.show" must be a boolean')
})

test('loadConfig validates window webPreferences subset types', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const windowsPath = join(fixtureDir, 'frontron', 'windows', 'index.ts')
  const windowsSource = readFileSync(windowsPath, 'utf8')

  writeFileSync(
    windowsPath,
    windowsSource.replace('    height: 800,', "    height: 800,\n    zoomFactor: 0,\n    sandbox: 'yes',"),
  )

  await expect(
    loadConfig({
      cwd: join(fixtureDir, 'src', 'nested'),
    }),
  ).rejects.toThrow('"windows.main.zoomFactor" must be a positive number')
})

test('loadConfig validates supported window title bar styles', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const windowsPath = join(fixtureDir, 'frontron', 'windows', 'index.ts')
  const windowsSource = readFileSync(windowsPath, 'utf8')

  writeFileSync(
    windowsPath,
    windowsSource.replace('    height: 800,', "    height: 800,\n    titleBarStyle: 'glass',"),
  )

  await expect(
    loadConfig({
      cwd: join(fixtureDir, 'src', 'nested'),
    }),
  ).rejects.toThrow('"windows.main.titleBarStyle" must be one of')
})

test('loadConfig rejects framework-owned window advanced overrides', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const windowsPath = join(fixtureDir, 'frontron', 'windows', 'index.ts')
  const windowsSource = readFileSync(windowsPath, 'utf8')

  writeFileSync(
    windowsPath,
    windowsSource.replace(
      '    height: 800,',
      [
        '    height: 800,',
        '    advanced: {',
        '      webPreferences: {',
        '        preload: "./custom-preload.js",',
        '      },',
        '    },',
      ].join('\n'),
    ),
  )

  await expect(
    loadConfig({
      cwd: join(fixtureDir, 'src', 'nested'),
    }),
  ).rejects.toThrow('"windows.main.advanced" cannot set "webPreferences"')
})

test('loadConfig validates window min and max dimensions', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const windowsPath = join(fixtureDir, 'frontron', 'windows', 'index.ts')
  const windowsSource = readFileSync(windowsPath, 'utf8')

  writeFileSync(
    windowsPath,
    windowsSource.replace(
      '    height: 800,',
      '    height: 800,\n    minWidth: 1400,\n    maxWidth: 1200,',
    ),
  )

  await expect(
    loadConfig({
      cwd: join(fixtureDir, 'src', 'nested'),
    }),
  ).rejects.toThrow('"windows.main.minWidth" cannot be greater than "windows.main.maxWidth"')
})

test('loadConfig validates build windows targets', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  build: {',
        '    windows: { targets: [] },',
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  await expect(
    loadConfig({
      cwd: join(fixtureDir, 'src', 'nested'),
    }),
  ).rejects.toThrow('"build.windows.targets" must be a string or non-empty array')
})

test('loadConfig validates supported Windows packaging target names', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  build: {',
        "    windows: { targets: ['zip'] },",
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  await expect(
    loadConfig({
      cwd: join(fixtureDir, 'src', 'nested'),
    }),
  ).rejects.toThrow('must be one of: dir, nsis, portable')
})

test('loadConfig validates build publish modes', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  build: {',
        "    publish: 'sometimes',",
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  await expect(
    loadConfig({
      cwd: join(fixtureDir, 'src', 'nested'),
    }),
  ).rejects.toThrow('"build.publish"')
})

test('loadConfig validates rust bridge binding descriptors', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace("returns: 'int'", "returns: 'number'"),
  )

  await expect(
    loadConfig({
      cwd: join(fixtureDir, 'src', 'nested'),
    }),
  ).rejects.toThrow('must be one of: void, int, double, bool, string')
})

test('loadConfig rejects void rust bridge arguments', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace("args: ['int', 'int']", "args: ['void']"),
  )

  await expect(
    loadConfig({
      cwd: join(fixtureDir, 'src', 'nested'),
    }),
  ).rejects.toThrow('cannot use "void"')
})

test('loadConfig resolves the official rust slot when it is enabled', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(configPath, configSource.replace('enabled: false', 'enabled: true'))

  const loaded = await loadConfig({
    cwd: join(fixtureDir, 'src', 'nested'),
  })

  expect(loaded.config.rust?.enabled).toBe(true)
  expect(loaded.config.rust?.cargoTomlPath).toBe(
    join(fixtureDir, 'frontron', 'rust', 'Cargo.toml'),
  )
  expect(loaded.config.rust?.libRsPath).toBe(
    join(fixtureDir, 'frontron', 'rust', 'src', 'lib.rs'),
  )
})

test('loadConfig fails when rust is enabled without the official slot files', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(configPath, configSource.replace('enabled: false', 'enabled: true'))
  rmSync(join(fixtureDir, 'frontron', 'rust', 'src', 'lib.rs'))

  await expect(
    loadConfig({
      cwd: join(fixtureDir, 'src', 'nested'),
    }),
  ).rejects.toThrow('Rust is enabled but src/lib.rs was not found')
})
