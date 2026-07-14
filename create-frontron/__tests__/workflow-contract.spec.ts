import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const workspaceRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

function readWorkflow(name: string): string {
  return readFileSync(join(workspaceRoot, '.github/workflows', name), 'utf8')
}

function readJob(workflow: string, name: string, nextName?: string): string {
  const start = workflow.indexOf(`  ${name}:`)
  const end = nextName ? workflow.indexOf(`  ${nextName}:`) : workflow.length

  if (start < 0 || end < start) {
    throw new Error(`Cannot find workflow job section: ${name}`)
  }

  return workflow.slice(start, end)
}

test('release waits for the reusable compatibility gate before OIDC publish', () => {
  const releaseWorkflow = readWorkflow('frontron-release.yml')
  const compatibilityWorkflow = readWorkflow('frontron-compatibility.yml')
  const compatibilityJob = readJob(releaseWorkflow, 'compatibility', 'publish')
  const publishJob = readJob(releaseWorkflow, 'publish')
  const setupNodeIndex = publishJob.indexOf('- name: Setup Node')
  const auditedNpmIndex = publishJob.indexOf('- name: Use the audited npm CLI')
  const publishIndex = publishJob.indexOf('- name: Verify and publish both packages')

  expect(compatibilityWorkflow).toContain('  workflow_call:')
  expect(compatibilityJob).toContain('uses: ./.github/workflows/frontron-compatibility.yml')
  expect(compatibilityJob).toMatch(/permissions:\s*\r?\n\s+contents: read/)
  expect(publishJob).toContain('needs: compatibility')
  expect(publishJob).toContain('environment: npm')
  expect(releaseWorkflow).toContain('id-token: write')
  expect(setupNodeIndex).toBeGreaterThanOrEqual(0)
  expect(auditedNpmIndex).toBeGreaterThan(setupNodeIndex)
  expect(publishIndex).toBeGreaterThan(auditedNpmIndex)
})

test('release compatibility covers supported platforms, runtimes, and package managers', () => {
  const workflow = readWorkflow('frontron-compatibility.yml')
  const nativeStarter = readJob(workflow, 'native-starter', 'node-boundaries')
  const nodeBoundaries = readJob(workflow, 'node-boundaries', 'public-frameworks')
  const publicFrameworks = readJob(workflow, 'public-frameworks', 'cross-platform-frameworks')
  const crossPlatformFrameworks = readJob(workflow, 'cross-platform-frameworks', 'package-managers')
  const packageManagers = readJob(workflow, 'package-managers', 'nested-pnpm-workspace')
  const nestedPnpmWorkspace = readJob(workflow, 'nested-pnpm-workspace')

  expect(workflow).toContain('  workflow_dispatch:')
  expect(workflow).toContain('  schedule:')
  expect(workflow).toContain('cron: "17 18 * * 0"')

  for (const os of ['ubuntu-latest', 'macos-latest', 'windows-latest']) {
    expect(nativeStarter).toContain(`- ${os}`)
    expect(packageManagers).toContain(`- ${os}`)
    expect(nestedPnpmWorkspace).toContain(`- ${os}`)
  }

  expect(nativeStarter).toContain('node-version: "24"')
  expect(publicFrameworks).toContain('runs-on: ubuntu-latest')
  expect(publicFrameworks).toContain('node-version: "24"')

  for (const frameworkCase of [
    'vite',
    'vitepress',
    'generic-node-server',
    'next-export',
    'next-standalone',
    'nuxt',
    'remix',
    'sveltekit-static',
    'sveltekit-node',
  ]) {
    expect(publicFrameworks).toContain(`- ${frameworkCase}`)
  }

  for (const os of ['macos-latest', 'windows-latest']) {
    expect(crossPlatformFrameworks).toContain(`- ${os}`)
  }

  for (const frameworkCase of ['vite', 'next-standalone', 'nuxt', 'remix', 'sveltekit-node']) {
    expect(crossPlatformFrameworks).toContain(`- ${frameworkCase}`)
  }

  expect(nodeBoundaries).toContain('- "22.15.0"')
  expect(nodeBoundaries).toContain('- "26"')
  expect(nodeBoundaries).not.toContain('- "24"')
  expect(nodeBoundaries).toContain('- vite')
  expect(nodeBoundaries).toContain('- next-standalone')

  for (const manager of ['pnpm', 'yarn', 'bun']) {
    expect(packageManagers).toContain(`- ${manager}`)
  }

  expect(packageManagers).toContain(
    'node release.mjs package-manager-smoke ${{ matrix.manager }} --package',
  )
  expect(nestedPnpmWorkspace).toContain('FRONTRON_TEST_PNPM_11: "1"')
  expect(nestedPnpmWorkspace).toContain(
    'npm test -- __tests__/pnpm-workspace-yaml.spec.ts -t "actual pnpm 11 reads default and nested generated workspace settings"',
  )
})

test('general CI uses a sparse supported runtime matrix', () => {
  const verifyJob = readJob(readWorkflow('frontron-ci.yml'), 'verify', 'release-verify')

  expect(verifyJob).toContain('matrix.runtime.os')
  expect(verifyJob).toContain('matrix.runtime.node')
  expect(verifyJob.match(/node: "22\.15\.0"/g)).toHaveLength(1)
  expect(verifyJob.match(/node: "24"/g)).toHaveLength(3)
  expect(verifyJob.match(/node: "26"/g)).toHaveLength(1)
})
