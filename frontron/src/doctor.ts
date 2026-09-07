import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { inspectDoctorState } from './doctor/inspections'
import {
  createDoctorStatus,
  writeDoctorReport,
  type DoctorContext,
  type DoctorFindings,
} from './doctor/report'
import { MANIFEST_PATH, readManifest } from './init/manifest'
import type { PackageJson } from './init/shared'
import {
  assertProjectPathSafe,
  formatProjectPathBlocker,
  inspectProjectPath,
} from './project-paths'
import { TRANSACTION_JOURNAL_PATH } from './transaction-journal'

export type { DoctorContext, DoctorOutput } from './doctor/report'

// doctor는 읽기 전용 명령이므로 저널 존재만 확인하고 복구를 시도하지 않는다.
function collectPendingTransactionState(cwd: string) {
  return readdirSync(cwd).filter((entry) => entry === TRANSACTION_JOURNAL_PATH)
}

function reportPendingTransaction(context: DoctorContext, entries: string[]) {
  const findings: DoctorFindings = {
    checks: ['transaction state inspected without mutation'],
    warnings: ['Doctor did not recover or modify the pending transaction state.'],
    blockers: entries.map((entry) => `Pending transaction journal detected: ${entry}`),
  }

  writeDoctorReport(context, {
    status: 'blocked',
    manifestFound: existsSync(resolve(context.cwd, MANIFEST_PATH)),
    findings,
    pendingTransactionState: true,
  })
}

function readProjectPackageJson(cwd: string) {
  const packageJsonPath = join(cwd, 'package.json')
  assertProjectPathSafe(cwd, packageJsonPath, 'package.json')

  if (!existsSync(packageJsonPath)) {
    throw new Error('package.json was not found in the current directory.')
  }

  return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson
}

// manifest 경로 검증은 내용을 읽기 전에 끝내 안전하지 않은 경로를 따라가지 않는다.
function inspectManifestPath(cwd: string, findings: DoctorFindings) {
  const manifestPath = resolve(cwd, MANIFEST_PATH)
  const inspection = inspectProjectPath(cwd, manifestPath)
  if (inspection.safe) return true

  findings.blockers.push(formatProjectPathBlocker(cwd, 'Frontron manifest', inspection))
  return false
}

// runDoctor는 입력 확인과 검사 순서만 조율하고 실제 판정/출력 책임은 하위 모듈에 둔다.
export async function runDoctor(context: DoctorContext) {
  const pendingTransactionState = collectPendingTransactionState(context.cwd)
  if (pendingTransactionState.length > 0) {
    reportPendingTransaction(context, pendingTransactionState)
    return 1
  }

  const packageJson = readProjectPackageJson(context.cwd)
  const findings: DoctorFindings = {
    checks: ['package.json found'],
    warnings: [],
    blockers: [],
  }

  if (!inspectManifestPath(context.cwd, findings)) {
    writeDoctorReport(context, { status: 'blocked', manifestFound: true, findings })
    return 1
  }

  const manifest = readManifest(context.cwd)
  if (!manifest) {
    findings.warnings.push(`${MANIFEST_PATH} was not found. Run "frontron init" before doctor.`)
    findings.blockers.push('Frontron has not been initialized in this project.')
    writeDoctorReport(context, { status: 'not initialized', manifestFound: false, findings })
    return 1
  }

  findings.checks.push(`${MANIFEST_PATH} found`)
  inspectDoctorState(context.cwd, packageJson, manifest, findings)
  writeDoctorReport(context, {
    status: createDoctorStatus(findings),
    manifestFound: true,
    findings,
  })

  return findings.blockers.length > 0 ? 1 : 0
}
