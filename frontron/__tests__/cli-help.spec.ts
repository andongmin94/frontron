import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import * as fixtures from './helpers/frontron-cli-fixtures'

describe('frontron CLI help', () => {
  test('prints init-focused help when no command is given', async () => {
    const output = fixtures.createOutput()

    const exitCode = await runCli([], output)
    const combined = output.info.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(combined).toContain('Usage: frontron <init|doctor|clean|update> [options]')
    expect(combined).toContain('frontron init')
    expect(combined).toContain('doctor')
    expect(combined).toContain('clean')
    expect(combined).toContain('update')
    expect(combined).toContain('npm create frontron@latest')
    expect(combined).toContain('app-owned')
    expect(combined).toContain('Run "frontron <command> --help" for command-specific options.')
  })

  test('prints command-specific help', async () => {
    const initOutput = fixtures.createOutput()
    const doctorOutput = fixtures.createOutput()
    const cleanOutput = fixtures.createOutput()
    const updateOutput = fixtures.createOutput()

    expect(await runCli(['init', '--help'], initOutput)).toBe(0)
    expect(await runCli(['doctor', '--help'], doctorOutput)).toBe(0)
    expect(await runCli(['clean', '--help'], cleanOutput)).toBe(0)
    expect(await runCli(['update', '--help'], updateOutput)).toBe(0)

    expect(initOutput.info.mock.calls.flat().join('\n')).toContain('Usage: frontron init [options]')
    expect(doctorOutput.info.mock.calls.flat().join('\n')).toContain('Usage: frontron doctor')
    expect(cleanOutput.info.mock.calls.flat().join('\n')).toContain('Usage: frontron clean [options]')
    const updateHelp = updateOutput.info.mock.calls.flat().join('\n')

    expect(updateHelp).toContain('Usage: frontron update [options]')
    expect(updateHelp).toContain('--desktop-dir <path>')
    expect(updateHelp).toContain('--server-entry <path>')
  })
})
