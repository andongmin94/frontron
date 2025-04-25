import type { PackageJsonOwnershipClaim } from '../init/manifest'

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
  claim: PackageJsonOwnershipClaim
  action: 'restore'
}

export type CleanPnpmWorkspaceChange = {
  claim: PackageJsonOwnershipClaim
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
  warnings: string[]
  blockers: string[]
}
