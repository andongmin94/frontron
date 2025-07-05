import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import {
  FIXTURE_MARKERS,
  assertRendererReport,
  instrumentDevLifecycleProcessTracking,
  instrumentRendererProbe,
  parseArgs,
} from '../scripts/release-matrix-smoke.mjs'

const tempDirectories = []

// createTempApp 함수는 probe 계측 테스트에 필요한 격리 앱 루트를 만든다.
function createTempApp() {
  const appRoot = mkdtempSync(join(tmpdir(), 'frontron-release-matrix-unit-'))
  tempDirectories.push(appRoot)
  return appRoot
}

// createValidReport 함수는 renderer 검증의 성공 기준을 한곳에 고정한다.
function createValidReport(overrides = {}) {
  return {
    ok: true,
    httpStatus: 200,
    href: 'frontron://app/',
    protocol: 'frontron:',
    origin: 'frontron://app',
    bodyText: 'fixture ready',
    domMarker: FIXTURE_MARKERS.vite,
    bridgeType: 'object',
    ...overrides,
  }
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('release matrix smoke options', () => {
  test('keeps dev lifecycle enabled on the release default path', () => {
    expect(parseArgs([])).toEqual({
      selectedCase: 'all',
      devLifecycle: true,
      devLifecycleTimeoutMs: 120_000,
      help: false,
    })
  })

  test('supports an explicit opt-out and bounded timeout override', () => {
    expect(
      parseArgs(['next-standalone', '--skip-dev-lifecycle', '--dev-lifecycle-timeout=45000']),
    ).toMatchObject({
      selectedCase: 'next-standalone',
      devLifecycle: false,
      devLifecycleTimeoutMs: 45_000,
    })
    expect(() => parseArgs(['--dev-lifecycle-timeout', '9999'])).toThrow('between 10000 and 600000')
  })
})

describe('renderer report validation', () => {
  const expectations = {
    label: 'test renderer probe',
    expectedMarker: FIXTURE_MARKERS.vite,
    expectedProtocol: 'frontron:',
    expectedOrigins: ['frontron://app'],
    expectedBridgeType: 'object',
  }

  test('accepts a 2xx page with the fixture-specific DOM marker', () => {
    expect(() => assertRendererReport(createValidReport(), expectations)).not.toThrow()
  })

  test('rejects a 502 response even when it has non-empty error-page text', () => {
    expect(() =>
      assertRendererReport(
        createValidReport({ httpStatus: 502, bodyText: 'Bad Gateway' }),
        expectations,
      ),
    ).toThrow('invalid report')
  })

  test('rejects a 200 framework error page without the unique DOM marker', () => {
    expect(() =>
      assertRendererReport(
        createValidReport({ bodyText: 'Application Error', domMarker: null }),
        expectations,
      ),
    ).toThrow('invalid report')
  })

  test('rejects a renderer that loaded from an unexpected dev origin', () => {
    expect(() =>
      assertRendererReport(
        createValidReport({ href: 'http://127.0.0.1:5173/', origin: 'http://127.0.0.1:5173' }),
        expectations,
      ),
    ).toThrow('invalid report')
  })

  test('accepts an explicitly allowed loopback alias on the same port', () => {
    expect(() =>
      assertRendererReport(
        createValidReport({
          href: 'http://localhost:4173/',
          protocol: 'http:',
          origin: 'http://localhost:4173',
        }),
        {
          ...expectations,
          expectedProtocol: 'http:',
          expectedOrigins: ['http://127.0.0.1:4173', 'http://localhost:4173'],
        },
      ),
    ).not.toThrow()
  })

  test('rejects a loopback alias on a different port', () => {
    expect(() =>
      assertRendererReport(
        createValidReport({
          href: 'http://localhost:4174/',
          protocol: 'http:',
          origin: 'http://localhost:4174',
        }),
        {
          ...expectations,
          expectedProtocol: 'http:',
          expectedOrigins: ['http://127.0.0.1:4173', 'http://localhost:4173'],
        },
      ),
    ).toThrow('invalid report')
  })

  test('rejects a renderer whose preload bridge did not load', () => {
    expect(() =>
      assertRendererReport(createValidReport({ bridgeType: 'undefined' }), expectations),
    ).toThrow('invalid report')
  })
})

describe('scratch source instrumentation', () => {
  test('adds an HTTP fetch status and DOM marker lookup to the packaged renderer probe', () => {
    const appRoot = createTempApp()
    const electronRoot = join(appRoot, 'src', 'electron')
    mkdirSync(electronRoot, { recursive: true })
    writeFileSync(
      join(electronRoot, 'main.ts'),
      `const result = await mainWindow?.webContents.executeJavaScript(
        \`({
          protocol: window.location.protocol,
          origin: window.location.origin,
          title: document.title,
          bodyText: document.body?.innerText ?? "",
          bridgeType: typeof window.electron,
        })\`,
        true
      )
      app.exit(0)
`,
      'utf8',
    )

    instrumentRendererProbe(appRoot)

    const source = readFileSync(join(electronRoot, 'main.ts'), 'utf8')
    expect(source).toContain('const response = await fetch(window.location.href')
    expect(source).toContain('httpStatus: response.status')
    expect(source).toContain('document.querySelector("[data-frontron-smoke]")')
    expect(source).toContain('FRONTRON_RENDERER_PROBE_KEEP_ALIVE')
  })

  test('records both direct child PIDs for lifecycle shutdown verification', () => {
    const appRoot = createTempApp()
    const electronRoot = join(appRoot, 'electron')
    mkdirSync(electronRoot, { recursive: true })
    writeFileSync(
      join(electronRoot, 'serve.ts'),
      `export const startRendererServer = startRendererRuntime
export const stopRendererServer = stopRendererRuntime

async function runDevApp() {
  const webDevProcess = spawnWebDevServer()
  let electronProcess = spawn('electron')

    electronProcess.once('error', (error) => {
      console.error(error)
    })
}
`,
      'utf8',
    )

    instrumentDevLifecycleProcessTracking(appRoot)

    const source = readFileSync(join(electronRoot, 'serve.ts'), 'utf8')
    expect(source).toContain('FRONTRON_DEV_LIFECYCLE_PROCESS_PATH')
    expect(source).toContain('writeDevLifecycleProcessReport(webDevProcess, null)')
    expect(source).toContain('writeDevLifecycleProcessReport(webDevProcess, electronProcess)')
  })
})

test('every packaged matrix fixture has a distinct DOM marker', () => {
  const markers = Object.values(FIXTURE_MARKERS)

  expect(Object.keys(FIXTURE_MARKERS)).toHaveLength(10)
  expect(new Set(markers).size).toBe(markers.length)
  expect(markers.every((marker) => marker.startsWith('frontron-smoke-'))).toBe(true)
})
