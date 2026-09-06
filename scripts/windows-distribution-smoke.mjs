import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { assertSecureProbe, createHarness, installProbe, readJson, repoRoot, writeFiles, writeJson } from './consumer-smoke/harness.mjs'

assert.equal(process.platform, 'win32', 'Run this check on a disposable Windows runner: it installs and removes test MSIs.')
assert.equal(process.arch, 'x64', 'This distribution check covers Windows x64 only.')
const harness = createHarness('windows-distribution')
const { root, reports, npm, run, pack } = harness
const template = readJson(join(repoRoot, 'create-frontron/template/package.json'))
const outcomes = []
writeJson(join(root, 'package.json'), { private: true })

async function checkDistribution(appRoot, buildScript, electronDir, counter) {
  const pkg = readJson(join(appRoot, 'package.json'))
  const product = pkg.build.productName
  assert.equal(typeof product, 'string')
  assert.equal(pkg.build.executableName, undefined)
  assert.equal(pkg.build.win?.executableName, undefined)
  const restoreProbe = installProbe(appRoot, electronDir)
  try {
    await npm(['run', buildScript, '--', '--dir'], appRoot)
    // Reuse the already-packaged application with the installed builder's
    // official API. Returned artifact paths identify the exact outputs; no
    // executable globbing or packaging/naming overrides are used.
    const manifest = join(reports, `${pkg.name}-artifacts.json`)
    const driver = join(root, `${pkg.name}-build.cjs`)
    writeFileSync(driver, `const { createRequire } = require('node:module');
const fs = require('node:fs');
const req = createRequire(${JSON.stringify(join(appRoot, 'package.json'))});
const { build, Platform, Arch } = req('electron-builder');
build({ projectDir: ${JSON.stringify(appRoot)},
  prepackaged: ${JSON.stringify(join(appRoot, pkg.build.directories.output, 'win-unpacked'))},
  targets: Platform.WINDOWS.createTarget(['msi', 'portable'], Arch.x64), publish: 'never'
}).then(paths => fs.writeFileSync(${JSON.stringify(manifest)}, JSON.stringify(paths, null, 2) + '\\n'))
  .catch(error => { console.error(error); process.exitCode = 1; });
`)
    await run(process.execPath, [driver], appRoot)
    const artifacts = readJson(manifest)
    const select = (extension) => {
      const paths = artifacts.filter(file => file.endsWith(extension))
      assert.equal(paths.length, 1, `Expected one ${extension}: ${JSON.stringify(artifacts)}`)
      assert.ok(statSync(paths[0]).size > 1_000_000)
      return paths[0]
    }
    const distributionRoot = join(root, `${pkg.name} distributions`)
    mkdirSync(distributionRoot)
    const msi = join(distributionRoot, basename(select('.msi')))
    const portable = join(distributionRoot, basename(select('.exe')))
    copyFileSync(select('.msi'), msi)
    copyFileSync(select('.exe'), portable)
    copyFileSync(join(appRoot, 'package-lock.json'), join(reports, `${pkg.name}-package-lock.json`))

    const hiddenSource = `${appRoot}-unavailable`
    renameSync(appRoot, hiddenSource)
    try {
      const unrelatedCwd = join(distributionRoot, 'unrelated working directory')
      mkdirSync(unrelatedCwd)
      const sentinel = join(unrelatedCwd, 'keep.txt')
      writeFileSync(sentinel, 'unrelated data\n')
      const result = { name: pkg.name, artifacts: [basename(msi), basename(portable)], sourceUnavailable: true, portableLaunches: 0, msiInstalled: false, msiRemoved: false }
      for (const attempt of [1, 2]) {
        const probePath = join(reports, `${pkg.name}-portable-${attempt}.json`)
        await run(portable, [], unrelatedCwd, { timeout: 120_000, env: { FRONTRON_CONSUMER_PROBE: probePath } })
        assertSecureProbe(probePath, { counter })
        result.portableLaunches += 1
      }

      const installDir = join(distributionRoot, 'Installed App')
      const executable = join(installDir, `${product}.exe`)
      const userFile = join(installDir, 'user-created-note.txt')
      const errors = []
      let installed = false
      try {
        await run('msiexec.exe', ['/i', msi, '/qn', '/norestart', `APPLICATIONFOLDER=${installDir}`, '/L*v', join(reports, `${pkg.name}-install.log`)], unrelatedCwd, { codes: [0, 3010] })
        installed = true
        result.msiInstalled = true
        assert.ok(existsSync(executable), `MSI did not install ${executable}`)
        writeFileSync(userFile, 'user data must survive uninstall\n')
        const probePath = join(reports, `${pkg.name}-installed.json`)
        await run(executable, [], unrelatedCwd, { timeout: 120_000, env: { FRONTRON_CONSUMER_PROBE: probePath } })
        const probe = assertSecureProbe(probePath, { counter })
        assert.equal(realpathSync.native(probe.execPath), realpathSync.native(executable))
      } catch (error) { errors.push(error) }
      finally {
        if (installed) {
          try {
            await run('msiexec.exe', ['/x', msi, '/qn', '/norestart', '/L*v', join(reports, `${pkg.name}-uninstall.log`)], unrelatedCwd, { codes: [0, 3010] })
            assert.equal(existsSync(executable), false, 'Uninstall left the application executable')
            assert.equal(readFileSync(userFile, 'utf8'), 'user data must survive uninstall\n')
            result.msiRemoved = true
          } catch (error) { errors.push(error) }
        }
      }
      assert.equal(readFileSync(sentinel, 'utf8'), 'unrelated data\n')
      outcomes.push(result)
      writeJson(join(reports, 'summary.json'), outcomes)
      if (errors.length) throw new AggregateError(errors, 'Installed application validation failed')
    } finally {
      renameSync(hiddenSource, appRoot)
    }
  } finally {
    restoreProbe()
  }
}

try {
  const createTarball = await pack('create-frontron')
  const frontronTarball = await pack('frontron')
  const starterName = 'frontron-distribution-starter'
  await npm(['exec', '--yes', '--package', createTarball, '--', 'create-frontron', starterName])
  const starter = join(root, starterName)
  await npm(['install', '--fund=false'], starter)
  await npm(['audit', '--audit-level=moderate'], starter)
  await checkDistribution(starter, 'build', 'src/electron', false)

  const retrofit = join(root, 'frontron-distribution-retrofit')
  mkdirSync(retrofit)
  const pkg = {
    name: 'frontron-distribution-retrofit', version: '0.1.0', private: true, type: 'module',
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
  await npm(['exec', '--', 'frontron', 'init', '--yes'], retrofit)
  await npm(['install', '--fund=false'], retrofit)
  await npm(['audit', '--audit-level=moderate'], retrofit)
  await checkDistribution(retrofit, 'frontron:build', 'electron', true)
  await npm(['exec', '--', 'frontron', 'clean', '--yes'], retrofit)
  assert.deepEqual(readJson(join(retrofit, 'package.json')).scripts, pkg.scripts)
  for (const [file, text] of Object.entries(sources)) assert.equal(readFileSync(join(retrofit, file), 'utf8'), text)
  await npm(['run', 'build'], retrofit)
  console.log('[consumer] Windows MSI install/run/uninstall and portable launch checks passed for starter and retrofit.')
  harness.cleanup()
} catch (error) {
  console.error(error)
  console.error(`[consumer] Failed consumer retained at ${root}; reports at ${reports}`)
  process.exitCode = 1
}
