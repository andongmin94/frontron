import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createHarness, readJson, repoRoot, writeFiles, writeJson } from './consumer-smoke/harness.mjs'
import { assertMacProbe, installMacProbe } from './consumer-smoke/macos-probe.mjs'

assert.equal(process.platform, 'darwin', 'Run on a disposable macOS runner: mounts temporary DMGs and exercises the clipboard.')
assert.equal(process.arch, 'arm64', 'This check covers native Apple Silicon only.')
const harness = createHarness('macos')
const { root, reports, npm, run, pack } = harness
const template = readJson(join(repoRoot, 'create-frontron/template/package.json'))
const outcomes = []
writeJson(join(root, 'package.json'), { private: true })

async function bundleExecutable(bundle, appId) {
  const plist = join(bundle, 'Contents/Info.plist')
  const { stdout } = await run('plutil', ['-convert', 'json', '-o', '-', plist])
  const info = JSON.parse(stdout)
  assert.equal(info.CFBundleIdentifier, appId)
  assert.equal(info.CFBundlePackageType, 'APPL')
  const name = info.CFBundleExecutable
  assert.equal(typeof name, 'string')
  assert.ok(name.length > 0 && name !== '.' && name !== '..' && !/[\\/\0]/.test(name))
  const executable = join(bundle, 'Contents/MacOS', name)
  assert.ok(existsSync(executable), `Missing bundle executable: ${executable}`)
  const architecture = await run('lipo', ['-archs', executable])
  assert.equal(architecture.stdout.trim(), 'arm64')
  return executable
}

async function checkConsumer(appRoot, { devScript, buildScript, electronDir, counter }) {
  const pkg = readJson(join(appRoot, 'package.json'))
  const appReports = join(reports, pkg.name)
  mkdirSync(appReports)
  const product = pkg.build.productName
  assert.equal(typeof product, 'string')
  const restore = installMacProbe(appRoot, electronDir)
  try {
    const devProbe = join(appReports, 'development.json')
    await run('npm', ['run', devScript], appRoot, {
      timeout: 120_000, env: { FRONTRON_CONSUMER_PROBE: devProbe },
    })
    assertMacProbe(devProbe, { packaged: false, counter })
    await npm(['run', buildScript, '--', '--dir'], appRoot)

    const bundleName = `${product}.app`
    const prepackaged = join(appRoot, pkg.build.directories.output, 'mac-arm64', bundleName)
    await bundleExecutable(prepackaged, pkg.build.appId)
    const manifest = join(appReports, 'artifacts.json')
    const driver = join(root, `${pkg.name}-distributions.cjs`)
    // Use the installed builder API and its artifact return values. Do not
    // replace the product's config, signing policy, icon, or security settings.
    writeFileSync(driver, `const {createRequire} = require('node:module');
const fs = require('node:fs');
const req = createRequire(${JSON.stringify(join(appRoot, 'package.json'))});
const {build, Platform, Arch} = req('electron-builder');
build({projectDir: ${JSON.stringify(appRoot)}, prepackaged: ${JSON.stringify(prepackaged)},
  targets: Platform.MAC.createTarget(['zip', 'dmg'], Arch.arm64), publish: 'never'
}).then(files => fs.writeFileSync(${JSON.stringify(manifest)}, JSON.stringify(files, null, 2) + '\\n'))
.catch(error => {console.error(error); process.exitCode = 1;});
`)
    await run(process.execPath, [driver], appRoot, { timeout: 600_000 })
    const artifacts = readJson(manifest)
    const distributionRoot = join(root, `${pkg.name} distributions`)
    mkdirSync(distributionRoot)
    const selectAndCopy = (extension) => {
      const paths = artifacts.filter(file => file.endsWith(extension))
      assert.equal(paths.length, 1, `Expected one ${extension}: ${JSON.stringify(artifacts)}`)
      assert.ok(statSync(paths[0]).size > 1_000_000)
      const target = join(distributionRoot, basename(paths[0]))
      copyFileSync(paths[0], target)
      return target
    }
    const zip = selectAndCopy('.zip')
    const dmg = selectAndCopy('.dmg')
    copyFileSync(join(appRoot, 'package-lock.json'), join(appReports, 'package-lock.json'))
    const sourceOffline = `${appRoot}-unavailable`
    renameSync(appRoot, sourceOffline)
    try {
      const unrelated = join(distributionRoot, 'unrelated working directory')
      mkdirSync(unrelated)
      const sentinel = join(unrelated, 'keep.txt')
      writeFileSync(sentinel, 'unrelated user data\n')
      const extracted = join(distributionRoot, 'extracted ZIP')
      mkdirSync(extracted)
      await run('ditto', ['-x', '-k', zip, extracted])
      const zipBundle = join(extracted, bundleName)
      const zipExecutable = await bundleExecutable(zipBundle, pkg.build.appId)
      for (const attempt of [1, 2]) {
        const probe = join(appReports, `zip-${attempt}.json`)
        await run(zipExecutable, [], unrelated, {
          timeout: 120_000, env: { FRONTRON_CONSUMER_PROBE: probe },
        })
        const result = assertMacProbe(probe, { packaged: true, counter })
        assert.equal(realpathSync.native(result.final.execPath), realpathSync.native(zipExecutable))
        if (attempt === 2) assert.equal(result.first.storageBefore, result.first.appInfo.name)
      }

      const mount = join(distributionRoot, 'mounted DMG')
      const installed = join(distributionRoot, 'copied Applications')
      mkdirSync(mount)
      mkdirSync(installed)
      await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, dmg])
      try {
        await run('ditto', [join(mount, bundleName), join(installed, bundleName)])
      } finally {
        await run('hdiutil', ['detach', mount])
      }
      // Launch the copied bundle after unmounting: neither the DMG nor the
      // original source tree may supply its resources at runtime.
      const dmgExecutable = await bundleExecutable(join(installed, bundleName), pkg.build.appId)
      const probe = join(appReports, 'dmg-copy.json')
      await run(dmgExecutable, [], unrelated, {
        timeout: 120_000, env: { FRONTRON_CONSUMER_PROBE: probe },
      })
      const result = assertMacProbe(probe, { packaged: true, counter })
      assert.equal(realpathSync.native(result.final.execPath), realpathSync.native(dmgExecutable))
      assert.equal(readFileSync(sentinel, 'utf8'), 'unrelated user data\n')
      outcomes.push({ name: pkg.name, development: true, zipLaunches: 2, dmgCopiedAndUnmounted: true,
        realWindowCloseAndActivate: true, packagedSandbox: true, clipboardRoundtrip: true,
        sourceUnavailableDuringLaunch: true, architecture: 'arm64' })
    } finally {
      renameSync(sourceOffline, appRoot)
    }
  } finally {
    restore()
  }
}

try {
  const createTarball = await pack('create-frontron')
  const frontronTarball = await pack('frontron')
  const name = 'frontron-macos-starter'
  await npm(['exec', '--yes', '--package', createTarball, '--', 'create-frontron', name])
  const starter = join(root, name)
  await npm(['install', '--fund=false'], starter)
  await npm(['audit', '--audit-level=moderate'], starter)
  await checkConsumer(starter, { devScript: 'app', buildScript: 'build', electronDir: 'src/electron', counter: false })

  const retrofit = join(root, 'frontron-macos-retrofit')
  mkdirSync(retrofit)
  const pkg = {
    name: 'frontron-macos-retrofit', version: '0.1.0', private: true, type: 'module',
    scripts: { dev: 'vite --host 127.0.0.1', build: 'vite build' },
    dependencies: { react: template.dependencies.react, 'react-dom': template.dependencies['react-dom'] },
    devDependencies: { vite: template.devDependencies.vite },
  }
  writeJson(join(retrofit, 'package.json'), pkg)
  const sources = {
    'vite.config.js': 'export default {}\n',
    'index.html': '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.js"></script></body></html>\n',
    'src/main.js': `import {createElement as h, useState} from 'react';
import {createRoot} from 'react-dom/client';
function App() { const [n, set] = useState(0); return h('main', null,
  h('h1', null, 'Desktop app ready'),
  h('button', {id:'counter', 'data-value': String(n), onClick: () => set(n+1)}, String(n))); }
createRoot(document.getElementById('root')).render(h(App));\n`,
  }
  writeFiles(retrofit, sources)
  await npm(['install', '-D', createTarball, frontronTarball, '--fund=false'], retrofit)
  await npm(['run', 'build'], retrofit)
  await npm(['exec', '--', 'frontron', 'init', '--yes'], retrofit)
  await npm(['install', '--fund=false'], retrofit)
  await npm(['audit', '--audit-level=moderate'], retrofit)
  await npm(['exec', '--', 'frontron', 'doctor'], retrofit)
  await npm(['exec', '--', 'frontron', 'update', '--yes'], retrofit)
  await checkConsumer(retrofit, { devScript: 'frontron:dev', buildScript: 'frontron:build', electronDir: 'electron', counter: true })
  await npm(['exec', '--', 'frontron', 'clean', '--yes'], retrofit)
  assert.equal(existsSync(join(retrofit, '.frontron/manifest.json')), false)
  assert.deepEqual(readJson(join(retrofit, 'package.json')).scripts, pkg.scripts)
  for (const [file, content] of Object.entries(sources)) assert.equal(readFileSync(join(retrofit, file), 'utf8'), content)
  await npm(['run', 'build'], retrofit)
  harness.cleanup()
  writeJson(join(reports, 'summary.json'), { passed: true, platform: 'darwin', architecture: 'arm64',
    consumers: outcomes, cleanAndWebRebuild: true, gatekeeperCertified: false, notarizationTested: false })
  console.log('[consumer] macOS ARM64 development, ZIP, DMG-copy, window lifecycle and clean passed.')
} catch (error) {
  console.error(error)
  console.error(`[consumer] Failed consumer retained at ${root}; reports at ${reports}`)
  process.exitCode = 1
}
