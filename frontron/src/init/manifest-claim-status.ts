import type { PackageJsonOwnershipClaim } from './manifest'
import { valuesEqual } from './package-json-path'
import type { ManagedState } from '../managed-state'

export type ClaimReadResult = {
  exists: boolean
  value: unknown
}

// inspectManifestClaim 함수는 manifest 소유권 claim이 현재 값과 어떤 상태인지 검사한다.
export function inspectManifestClaim(
  label: string,
  claim: PackageJsonOwnershipClaim,
  current: ClaimReadResult,
) {
  // manifest claim은 Frontron이 쓴 값을 나타내며 doctor는 존재 여부만 보고하고 수정하지 않는다.
  if (claim.action === 'array-value') {
    if (
      Array.isArray(current.value) &&
      current.value.some((value) => valuesEqual(value, claim.value))
    ) {
      return {
        state: 'unchanged' as ManagedState,
        check: `${label} ${claim.path} contains manifest-owned value`,
      }
    }

    if (!current.exists) {
      return {
        state: 'missing' as ManagedState,
        warning: `Manifest-owned ${label} field is missing: ${claim.path}`,
      }
    }

    if (Array.isArray(current.value)) {
      return {
        state: 'modified' as ManagedState,
        warning: `Manifest-owned ${label} array value is missing: ${claim.path}`,
      }
    }

    return {
      state: 'modified' as ManagedState,
      warning: `Manifest-owned ${label} field has local edits: ${claim.path}`,
    }
  }

  if (current.exists && valuesEqual(current.value, claim.value)) {
    return {
      state: 'unchanged' as ManagedState,
      check: `${label} ${claim.path} matches manifest`,
    }
  }

  if (!current.exists) {
    return {
      state: 'missing' as ManagedState,
      warning: `Manifest-owned ${label} field is missing: ${claim.path}`,
    }
  }

  return {
    state: 'modified' as ManagedState,
    warning: `Manifest-owned ${label} field has local edits: ${claim.path}`,
  }
}
