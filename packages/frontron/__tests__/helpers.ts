import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export function createFixtureProject() {
  const rootDir = mkdtempSync(join(tmpdir(), 'frontron-fixture-'))

  mkdirSync(join(rootDir, 'public'), { recursive: true })
  mkdirSync(join(rootDir, 'dist'), { recursive: true })
  mkdirSync(join(rootDir, 'frontron', 'bridge'), { recursive: true })
  mkdirSync(join(rootDir, 'frontron', 'hooks'), { recursive: true })
  mkdirSync(join(rootDir, 'frontron', 'rust', 'src'), { recursive: true })
  mkdirSync(join(rootDir, 'frontron', 'windows'), { recursive: true })
  mkdirSync(join(rootDir, 'src', 'nested'), { recursive: true })

  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        version: '1.2.3',
        private: true,
        type: 'module',
        description: 'Fixture package description',
        author: 'Fixture Package Author',
      },
      null,
      2,
    ),
  )

  writeFileSync(
    join(rootDir, 'frontron.config.ts'),
    "export { default } from './frontron/config'\n",
  )

  writeFileSync(
    join(rootDir, 'public', 'icon.png'),
    'icon',
  )

  writeFileSync(
    join(rootDir, 'dist', 'index.html'),
    '<html><body>fixture</body></html>',
  )

  writeFileSync(
    join(rootDir, 'frontron', 'types.ts'),
    [
      'export interface AppMeta {',
      '  name: string',
      '  id: string',
      '  icon?: string',
      '  description?: string',
      '  author?: string',
      '  copyright?: string',
      '}',
      '',
    ].join('\n'),
  )

  writeFileSync(
    join(rootDir, 'frontron', 'windows', 'index.ts'),
    [
      'const windows = {',
      '  main: {',
      "    route: '/',",
      '    width: 1280,',
      '    height: 800,',
      '  },',
      '}',
      '',
      'export default windows',
      '',
    ].join('\n'),
  )

  writeFileSync(
    join(rootDir, 'frontron', 'bridge', 'index.ts'),
    [
      'const bridge = {',
      '  app: {',
      "    getGreeting: () => 'hello from bridge',",
      '    add: (left, right) => Number(left) + Number(right),',
      '  },',
      '}',
      '',
      'export default bridge',
      '',
    ].join('\n'),
  )

  writeFileSync(
    join(rootDir, 'frontron', 'menu.ts'),
    [
      'const menu = [',
      '  {',
      "    label: 'Window',",
      '    submenu: [',
      '      {',
      "        label: 'Toggle Maximize',",
      '        onClick: ({ window }) => window.toggleMaximize(),',
      '      },',
      '    ],',
      '  },',
      ']',
      '',
      'export default menu',
      '',
    ].join('\n'),
  )

  writeFileSync(
    join(rootDir, 'frontron', 'tray.ts'),
    [
      'const tray = {',
      "  icon: './public/icon.png',",
      "  tooltip: 'Fixture Tray',",
      '  items: [',
      '    {',
      "      label: 'Show Window',",
      '      onClick: ({ window }) => window.show(),',
      '    },',
      '  ],',
      '}',
      '',
      'export default tray',
      '',
    ].join('\n'),
  )

  writeFileSync(
    join(rootDir, 'frontron', 'hooks', 'before-dev.ts'),
    [
      "import { writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      '',
      'const beforeDev = ({ rootDir }) => {',
      "  writeFileSync(join(rootDir, '.before-dev-hook'), 'before-dev')",
      '}',
      '',
      'export default beforeDev',
      '',
    ].join('\n'),
  )

  writeFileSync(
    join(rootDir, 'frontron', 'hooks', 'after-pack.ts'),
    [
      "import { writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      '',
      'const afterPack = ({ outputDir, packagedAppDir, rootDir }) => {',
      "  writeFileSync(join(rootDir, '.after-pack-hook'), `${String(outputDir)}::${String(packagedAppDir)}`)",
      '}',
      '',
      'export default afterPack',
      '',
    ].join('\n'),
  )

  writeFileSync(
    join(rootDir, 'frontron', 'hooks', 'index.ts'),
    [
      "import beforeDev from './before-dev'",
      "import afterPack from './after-pack'",
      '',
      'const hooks = {',
      '  beforeDev,',
      "  beforeBuild: `node -e \"require('node:fs').writeFileSync(require('node:path').join(process.cwd(), '.before-build-hook'), 'before-build')\"`,",
      '  afterPack,',
      '}',
      '',
      'export default hooks',
      '',
    ].join('\n'),
  )

  writeFileSync(
    join(rootDir, 'frontron', 'rust', 'Cargo.toml'),
    [
      '[package]',
      'name = "fixture_app_native"',
      'version = "0.1.0"',
      'edition = "2021"',
      '',
      '[lib]',
      'crate-type = ["cdylib"]',
      '',
    ].join('\n'),
  )

  writeFileSync(
    join(rootDir, 'frontron', 'rust', 'src', 'lib.rs'),
    [
      '#[no_mangle]',
      'pub extern "C" fn frontron_native_ready() -> i32 {',
      '    1',
      '}',
      '',
      '#[no_mangle]',
      'pub extern "C" fn frontron_native_add(left: i32, right: i32) -> i32 {',
      '    left + right',
      '}',
      '',
    ].join('\n'),
  )

  writeFileSync(
    join(rootDir, 'frontron', 'config.ts'),
    [
      "import type { AppMeta } from './types'",
      "import bridge from './bridge'",
      "import hooks from './hooks'",
      "import menu from './menu'",
      "import tray from './tray'",
      "import windows from './windows'",
      '',
      "const app: AppMeta = { name: 'Fixture App', id: 'com.example.fixture', icon: 'public/icon.png' }",
      '',
      'export default {',
      '  app,',
      '  web: {',
      "    dev: { command: 'node -e \"process.stdout.write(\\'dev-ok\\')\"', url: 'http://localhost:5173' },",
      "    build: { command: 'node -e \"process.stdout.write(\\'build-ok\\')\"', outDir: 'dist' },",
      '  },',
      '  windows,',
      '  bridge,',
      '  menu,',
      '  tray,',
      '  hooks,',
      '  rust: {',
      '    enabled: false,',
      '    bridge: {',
      '      math: {',
      "        add: { symbol: 'frontron_native_add', args: ['int', 'int'], returns: 'int' },",
      '      },',
      '    },',
      '  },',
      '}',
      '',
    ].join('\n'),
  )

  return rootDir
}

export function removeFixtureProject(rootDir: string) {
  rmSync(rootDir, { recursive: true, force: true })
}
