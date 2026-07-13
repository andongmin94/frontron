import type { PackageJsonOwnershipClaim } from '../init/manifest'
import type { YarnRcOwnershipClaim } from '../init/yarnrc-yaml'

export interface CleanOptions {
  yes: boolean
  force: boolean
  dryRun?: boolean
}

export interface CleanOutput {
  info(message: string): void
}

export interface CleanContext {
  cwd: string
  output: CleanOutput
}

export type CleanFileChange = {
  manifestPath: string
  absolutePath: string
  action: 'delete' | 'missing' | 'blocked'
  reason: string
  expectedHash?: string
}

export type CleanScriptChange = {
  name: string
  action: 'remove' | 'missing' | 'blocked'
}

export type CleanPackageJsonChange = {
  claim: PackageJsonOwnershipClaim
  action: 'restore'
}

export type CleanTsconfigJsonChange = {
  path: string
  claim: PackageJsonOwnershipClaim
  action: 'restore'
}

export type CleanPnpmWorkspaceChange = {
  path: string
  claim: PackageJsonOwnershipClaim
  action: 'restore'
}

export type CleanYarnRcChange = {
  path: string
  claim: YarnRcOwnershipClaim
  action: 'restore'
}

export type ClaimReadResult = {
  exists: boolean
  value: unknown
}

export type CleanPlan = {
  files: CleanFileChange[]
  scripts: CleanScriptChange[]
  packageJsonChanges: CleanPackageJsonChange[]
  tsconfigJsonChanges: CleanTsconfigJsonChange[]
  pnpmWorkspaceChanges: CleanPnpmWorkspaceChange[]
  yarnRcChanges: CleanYarnRcChange[]
  warnings: string[]
  blockers: string[]
}
