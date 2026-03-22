import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'

import type { ResolvedFrontronRustConfig } from '../src/types'
import * as nativeRuntime from '../src/runtime/native'

const fixtureDirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()

  for (const fixtureDir of fixtureDirs.splice(0)) {
    rmSync(fixtureDir, { recursive: true, force: true })
  }
})

function createRustFixture() {
  const rootDir = mkdtempSync(join(tmpdir(), 'frontron-rust-fixture-'))
  const rustPath = join(rootDir, 'frontron', 'rust')
  const rustConfig: ResolvedFrontronRustConfig = {
    enabled: true,
    path: rustPath,
    cargoTomlPath: join(rustPath, 'Cargo.toml'),
    sourceDir: join(rustPath, 'src'),
    libRsPath: join(rustPath, 'src', 'lib.rs'),
    bridge: {
      math: {
        add: {
          symbol: 'frontron_native_add',
          args: ['int', 'int'],
          returns: 'int',
        },
      },
    },
  }

  fixtureDirs.push(rootDir)
  mkdirSync(rustConfig.sourceDir, { recursive: true })
  writeFileSync(
    rustConfig.cargoTomlPath,
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
    rustConfig.libRsPath,
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

  return rustConfig
}

test('resolveRustArtifactPath uses debug and release targets from the official slot', () => {
  const rustConfig = createRustFixture()

  expect(nativeRuntime.resolveRustArtifactPath(rustConfig, 'development')).toBe(
    join(
      rustConfig.path,
      'target',
      'debug',
      nativeRuntime.resolveRustArtifactBasename('fixture_app_native'),
    ),
  )
  expect(nativeRuntime.resolveRustArtifactPath(rustConfig, 'production')).toBe(
    join(
      rustConfig.path,
      'target',
      'release',
      nativeRuntime.resolveRustArtifactBasename('fixture_app_native'),
    ),
  )
})

test('loadRustRuntime returns a disabled status when rust is not enabled', () => {
  const runtime = nativeRuntime.loadRustRuntime(undefined, 'development')

  expect(runtime.getStatus()).toEqual({
    enabled: false,
    loaded: false,
    ready: false,
  })
  expect(runtime.isReady()).toBe(false)
  expect(() => runtime.add(2, 3)).toThrow('rust.enabled is false')
  expect(runtime.getBridge()).toEqual({})
})

test('loadRustRuntime loads the official native artifact and calls the ready symbol', async () => {
  const rustConfig = createRustFixture()
  const artifactPath = nativeRuntime.resolveRustArtifactPath(rustConfig, 'development')
  const readySymbol = vi.fn(() => 1)
  const addSymbol = vi.fn((left: number, right: number) => left + right)
  const library = {
    func: vi.fn((definition: string) => {
      if (definition === 'int frontron_native_ready(void)') {
        return readySymbol
      }

      if (definition === 'int frontron_native_add(int, int)') {
        return addSymbol
      }

      throw new Error(`Unexpected definition: ${definition}`)
    }),
  }
  const koffi = {
    load: vi.fn(() => library),
  }

  mkdirSync(join(rustConfig.path, 'target', 'debug'), { recursive: true })
  writeFileSync(artifactPath, 'native-artifact')

  const runtime = nativeRuntime.loadRustRuntime(rustConfig, 'development', koffi as any)

  expect(runtime.getStatus()).toEqual({
    enabled: true,
    loaded: true,
    ready: true,
    artifactPath,
    symbolName: 'frontron_native_ready',
  })
  expect(runtime.isReady()).toBe(true)
  expect(runtime.add(2, 3)).toBe(5)
  await expect(runtime.getBridge().math.add(2, 3)).resolves.toBe(5)
  expect(koffi.load).toHaveBeenCalledWith(artifactPath)
  expect(library.func).toHaveBeenCalledWith('int frontron_native_ready(void)')
  expect(library.func).toHaveBeenCalledWith('int frontron_native_add(int, int)')
  expect(readySymbol).toHaveBeenCalledTimes(2)
  expect(addSymbol).toHaveBeenCalledWith(2, 3)
})

test('loadRustRuntime exposes disabled rust bridge handlers when the slot is scaffolded but disabled', async () => {
  const rustConfig = {
    ...createRustFixture(),
    enabled: false,
  }

  const runtime = nativeRuntime.loadRustRuntime(rustConfig, 'development')

  await expect(runtime.getBridge().math.add(2, 3)).rejects.toThrow('rust.enabled is false')
})

test('loadRustRuntime normalizes bool, double, and string bindings from rust.bridge descriptors', async () => {
  const rustConfig = {
    ...createRustFixture(),
    bridge: {
      file: {
        hasTxtExtension: {
          symbol: 'frontron_file_has_txt_extension',
          args: ['string'] as const,
          returns: 'bool' as const,
        },
      },
      meta: {
        isReady: {
          symbol: 'frontron_native_is_ready',
          returns: 'bool' as const,
        },
        describe: {
          symbol: 'frontron_native_describe',
          args: ['string', 'bool', 'double'] as const,
          returns: 'string' as const,
        },
      },
      system: {
        cpuCount: {
          symbol: 'frontron_system_cpu_count',
          returns: 'int' as const,
        },
      },
    },
  }
  const artifactPath = nativeRuntime.resolveRustArtifactPath(rustConfig, 'development')
  const readySymbol = vi.fn(() => true)
  const describeSymbol = vi.fn((label: string, enabled: boolean, ratio: number) => {
    return `${label}:${enabled ? 'on' : 'off'}:${ratio.toFixed(1)}`
  })
  const fileSymbol = vi.fn((path: string) => path.toLowerCase().endsWith('.txt'))
  const cpuCountSymbol = vi.fn(() => 8)
  const library = {
    func: vi.fn((definition: string) => {
      if (definition === 'bool frontron_file_has_txt_extension(string)') {
        return fileSymbol
      }

      if (definition === 'bool frontron_native_is_ready(void)') {
        return readySymbol
      }

      if (definition === 'int frontron_system_cpu_count(void)') {
        return cpuCountSymbol
      }

      if (definition === 'string frontron_native_describe(string, bool, double)') {
        return describeSymbol
      }

      throw new Error(`Unexpected definition: ${definition}`)
    }),
  }
  const koffi = {
    load: vi.fn(() => library),
  }

  mkdirSync(join(rustConfig.path, 'target', 'debug'), { recursive: true })
  writeFileSync(artifactPath, 'native-artifact')

  const runtime = nativeRuntime.loadRustRuntime(rustConfig, 'development', koffi as any)

  await expect(runtime.getBridge().file.hasTxtExtension('notes.txt')).resolves.toBe(true)
  await expect(runtime.getBridge().file.hasTxtExtension('notes.md')).resolves.toBe(false)
  await expect(runtime.getBridge().meta.isReady()).resolves.toBe(true)
  await expect(runtime.getBridge().meta.describe('alpha', true, 1.25)).resolves.toBe('alpha:on:1.3')
  await expect(runtime.getBridge().system.cpuCount()).resolves.toBe(8)
  expect(library.func).toHaveBeenCalledWith('bool frontron_file_has_txt_extension(string)')
  expect(library.func).toHaveBeenCalledWith('int frontron_system_cpu_count(void)')
  expect(library.func).toHaveBeenCalledWith('string frontron_native_describe(string, bool, double)')
  expect(fileSymbol).toHaveBeenCalledWith('notes.txt')
  expect(fileSymbol).toHaveBeenCalledWith('notes.md')
  expect(cpuCountSymbol).toHaveBeenCalledTimes(1)
  expect(describeSymbol).toHaveBeenCalledWith('alpha', true, 1.25)
})

test('loadRustRuntime validates config-driven bridge argument count and types at runtime', async () => {
  const rustConfig = {
    ...createRustFixture(),
  }
  const artifactPath = nativeRuntime.resolveRustArtifactPath(rustConfig, 'development')
  const readySymbol = vi.fn(() => 1)
  const addSymbol = vi.fn((left: number, right: number) => left + right)
  const library = {
    func: vi.fn((definition: string) => {
      if (definition === 'int frontron_native_ready(void)') {
        return readySymbol
      }

      if (definition === 'int frontron_native_add(int, int)') {
        return addSymbol
      }

      throw new Error(`Unexpected definition: ${definition}`)
    }),
  }
  const koffi = {
    load: vi.fn(() => library),
  }

  mkdirSync(join(rustConfig.path, 'target', 'debug'), { recursive: true })
  writeFileSync(artifactPath, 'native-artifact')

  const runtime = nativeRuntime.loadRustRuntime(rustConfig, 'development', koffi as any)

  await expect(runtime.getBridge().math.add(2)).rejects.toThrow('requires 2 argument(s), received 1')
  await expect(runtime.getBridge().math.add(2.5, 3)).rejects.toThrow('requires an integer')
  expect(addSymbol).not.toHaveBeenCalled()
})

test('loadRustRuntime fails when the built native artifact is missing', () => {
  const rustConfig = createRustFixture()

  expect(() => nativeRuntime.loadRustRuntime(rustConfig, 'production')).toThrow(
    'Rust native artifact not found',
  )
})
