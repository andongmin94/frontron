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

    const initHelp = initOutput.info.mock.calls.flat().join('\n')

    expect(initHelp).toContain('Usage: frontron init [options]')
    expect(initHelp).not.toContain('--force')
    expect(doctorOutput.info.mock.calls.flat().join('\n')).toContain('Usage: frontron doctor')
    expect(cleanOutput.info.mock.calls.flat().join('\n')).toContain(
      'Usage: frontron clean [options]',
    )
    const updateHelp = updateOutput.info.mock.calls.flat().join('\n')

    expect(updateHelp).toContain('Usage: frontron update [options]')
    expect(updateHelp).toContain('--dry-run')
    expect(updateHelp).toContain('--force')
    expect(updateHelp).not.toContain('--adapter')
    expect(updateHelp).not.toContain('--preset')
    expect(updateHelp).not.toContain('--desktop-dir')
    expect(updateHelp).not.toContain('--server-entry')
  })

  test('identifies the command before validating its options', async () => {
    const output = fixtures.createOutput()

    expect(await runCli(['--yes', 'init'], output)).toBe(1)
    expect(output.error.mock.calls.flat().join('\n')).toContain('Unknown command "--yes"')
  })

  test.each([
    ['doctor', '--yes'],
    ['clean', '--adapter=generic-static'],
    ['update', '--preset=minimal'],
  ])('%s rejects options outside its public surface', async (command, option) => {
    const output = fixtures.createOutput()

    expect(await runCli([command, option], output)).toBe(1)
    expect(output.error.mock.calls.flat().join('\n')).toContain(
      `Unknown option "${option}" for "frontron ${command}"`,
    )
  })

  test.each(['init', 'doctor', 'clean', 'update'])(
    '%s rejects positional arguments',
    async (command) => {
      const output = fixtures.createOutput()

      expect(await runCli([command, 'extra'], output)).toBe(1)
      expect(output.error.mock.calls.flat().join('\n')).toContain(
        `Unexpected positional argument "extra" for "frontron ${command}"`,
      )
    },
  )

  test('init --force points existing users to update', async () => {
    const output = fixtures.createOutput()

    expect(await runCli(['init', '--yes', '--force'], output)).toBe(1)
    const error = output.error.mock.calls.flat().join('\n')

    expect(error).toContain('--force is not available for "frontron init"')
    expect(error).toContain('frontron update --yes')
    expect(error).toContain('frontron update --yes --force')
  })
})
