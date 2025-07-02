import type { PackageJsonOwnershipClaim } from './manifest'

// mergePackageJsonClaims 함수는 기존 소유권 claim과 새 claim을 경로 기준으로 병합한다.
export function mergePackageJsonClaims(
  existingClaims: PackageJsonOwnershipClaim[] = [],
  nextClaims: PackageJsonOwnershipClaim[] = [],
) {
  const claims = new Map<string, PackageJsonOwnershipClaim>()

  // claim은 출처가 아니라 소유 값으로 식별해 update/init이 이전 기록을 보존하며 중복만 바꾼다.
  for (const claim of [...existingClaims, ...nextClaims]) {
    claims.set(`${claim.action ?? 'set'}:${claim.path}:${JSON.stringify(claim.value)}`, claim)
  }

  return [...claims.values()]
}

// replacePackageJsonClaims 함수는 새 템플릿이 계속 소유하는 claim만 남기고 최초 이전 값은 보존한다.
export function replacePackageJsonClaims(
  existingClaims: PackageJsonOwnershipClaim[] = [],
  nextClaims: PackageJsonOwnershipClaim[] = [],
) {
  return nextClaims.map((nextClaim) => {
    const existingClaim = existingClaims.find((candidate) => {
      if ((candidate.action ?? 'set') !== (nextClaim.action ?? 'set')) return false
      if (candidate.path !== nextClaim.path) return false

      return (
        nextClaim.action !== 'array-value' ||
        JSON.stringify(candidate.value) === JSON.stringify(nextClaim.value)
      )
    })

    return existingClaim
      ? {
          ...nextClaim,
          previous: existingClaim.previous,
        }
      : nextClaim
  })
}
