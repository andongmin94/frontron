export interface DoctorOutput {
  info(message: string): void
}

export interface DoctorContext {
  cwd: string
  output: DoctorOutput
}

export type DoctorFindings = {
  checks: string[]
  warnings: string[]
  blockers: string[]
}

type DoctorReportInput = {
  status: string
  manifestFound: boolean
  findings: DoctorFindings
  pendingTransactionState?: boolean
}

// 보고서 모양은 한곳에서만 관리해 각 검사 모듈이 문자열 배치를 신경 쓰지 않게 한다.
function addList(lines: string[], title: string, values: string[], emptyMessage: string) {
  lines.push(title)

  if (values.length === 0) {
    lines.push(`  ${emptyMessage}`)
    return
  }

  for (const value of values) lines.push(`  - ${value}`)
}

function createDoctorNextSteps(input: DoctorReportInput) {
  if (input.pendingTransactionState) {
    return [
      'Run init, clean, or update with --yes (without --dry-run) to recover the pending transaction, then inspect the project and rerun doctor.',
    ]
  }

  if (!input.manifestFound) {
    return ['Run "frontron init --dry-run" to preview the retrofit plan.']
  }

  if (input.findings.blockers.length > 0) {
    return ['Run "frontron update --dry-run" to inspect a guarded refresh plan.']
  }

  if (input.findings.warnings.length > 0) {
    return ['Review the warnings above before refreshing or cleaning generated files.']
  }

  return ['No action needed.']
}

export function writeDoctorReport(context: DoctorContext, input: DoctorReportInput) {
  const lines = ['Frontron Doctor', '', `Status: ${input.status}`, '']
  addList(lines, 'Checks:', input.findings.checks, '(none)')
  lines.push('')
  addList(lines, 'Warnings:', input.findings.warnings, 'No warnings found.')
  lines.push('')
  addList(lines, 'Blockers:', input.findings.blockers, 'No blockers found.')
  lines.push('')
  addList(lines, 'Next steps:', createDoctorNextSteps(input), '(none)')

  context.output.info(lines.join('\n'))
}

export function createDoctorStatus(findings: DoctorFindings) {
  if (findings.blockers.length > 0) return 'blocked'
  if (findings.warnings.length > 0) return 'warnings'
  return 'healthy'
}
