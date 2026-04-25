import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { InitPlan } from './plan'
import type { PackageJson } from './shared'

export function applyInitChanges(
  packageJsonPath: string,
  packageJson: PackageJson,
  plan: InitPlan,
) {
  for (const file of plan.files) {
    if (file.action === 'blocked') {
      continue
    }

    const filePath = file.path
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, file.content, 'utf8')
  }

  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')
}
