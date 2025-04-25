import type { PackageJsonOwnershipClaim } from './manifest'

// mergePackageJsonClaims 함수는 기존 소유권 claim과 새 claim을 경로 기준으로 병합한다.
export function mergePackageJsonClaims(
  existingClaims: PackageJsonOwnershipClaim[] = [],
  nextClaims: PackageJsonOwnershipClaim[] = [],
) {
  const claims = new Map<string, PackageJsonOwnershipClaim>()

  // A claim is identified by what Frontron owns, not by where the claim came
  // from. This lets update/init preserve old claims while replacing duplicates.
  for (const claim of [...existingClaims, ...nextClaims]) {
    claims.set(`${claim.action ?? 'set'}:${claim.path}:${JSON.stringify(claim.value)}`, claim)
  }

  return [...claims.values()]
}
