import type { PackageJsonOwnershipClaim } from './manifest'
import { valuesEqual } from './package-json-path'

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
  // Manifest claims describe exactly what Frontron wrote. Doctor only reports
  // whether that owned value is still present; it never mutates the project.
  if (claim.action === 'array-value') {
    if (
      Array.isArray(current.value) &&
      current.value.some((value) => valuesEqual(value, claim.value))
    ) {
      return {
        check: `${label} ${claim.path} contains manifest-owned value`,
      }
    }

    if (!current.exists) {
      return {
        warning: `Manifest-owned ${label} field is missing: ${claim.path}`,
      }
    }

    if (Array.isArray(current.value)) {
      return {
        warning: `Manifest-owned ${label} array value is missing: ${claim.path}`,
      }
    }

    return {
      warning: `Manifest-owned ${label} field has local edits: ${claim.path}`,
    }
  }

  if (current.exists && valuesEqual(current.value, claim.value)) {
    return {
      check: `${label} ${claim.path} matches manifest`,
    }
  }

  if (!current.exists) {
    return {
      warning: `Manifest-owned ${label} field is missing: ${claim.path}`,
    }
  }

  return {
    warning: `Manifest-owned ${label} field has local edits: ${claim.path}`,
  }
}
