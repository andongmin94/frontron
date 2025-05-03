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
