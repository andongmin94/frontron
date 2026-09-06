# Release preparation and publication

Verification, merging to `main`, and npm publication are separate operations.
No repository workflow publishes packages. `release.mjs` accepts only
`check-metadata` and `verify`; there is no `publish` command. The repository is
not an npm workspace root: operate in the two package directories.

## 1. Prepare the source candidate

Use a clean checkout of the intended source commit and review
[Unreleased](../CHANGELOG.md) and the [support matrix](SUPPORT.md). For an actual
release, choose a previously unused plain `x.y.z` version for **both** packages.
The current metadata checker does not accept semver prerelease suffixes. Do not
reuse an already published name/version, even when the Git source has changed.

Update both package manifests and lockfiles in the release commit. Keep
`frontron.dependencies.create-frontron` pinned to that exact version. In each
lockfile, align the top-level and root-package versions; in the Frontron lock,
also align the root dependency and the existing `../create-frontron` sibling
record. Preserve the repository's local sibling link rather than replacing the
published dependency with a `file:` path. Do not hand-edit registry integrity
values or perform unrelated dependency upgrades while versioning.

```bash
node release.mjs check-metadata
node release.mjs verify
```

`check-metadata` checks alignment, **not registry availability or publish
permission**. Review the version diff and clean-checkout verification before
committing. A version change requires fresh checks; success on an earlier
version is not release evidence for the new one.

## 2. Complete the existing gates

Require all of these jobs for the exact candidate; none may be skipped:

| Workflow | Required jobs |
| --- | --- |
| Verify | `quality (ubuntu-latest)` and `quality (windows-latest)` |
| Native consumers | `windows-distribution` and `next-standalone` |
| macOS consumers | `apple-silicon` |

They run for pull requests, pushes to `main`, and manual dispatch. Merge only
after the PR candidate passes and check the resulting `main` push as well.
Keep the workflow URLs, commit SHA, native reports and consumer lockfiles with
the release record. Artifact retention is seven days. No packaging success
establishes signing, notarization or support beyond [SUPPORT.md](SUPPORT.md).

`node release.mjs verify` by itself builds consumers; Windows/Linux desktop
execution needs `FRONTRON_TEST_ELECTRON_RUNTIME=1`. The macOS workflow runs its
own explicit native consumer script. Consult the linked test contracts for
platform prerequisites. Run MSI/DMG checks only on disposable machines.

## 3. Build local tarballs without publishing

After verification, run these commands from the repository root in Bash
(including Git Bash on Windows). They create files only; they do not publish or
change an npm tag. Use a new sibling output directory for each candidate.

```bash
set -euo pipefail
CANDIDATE_DIR="$(mktemp -d ../frontron-candidate.XXXXXX)"
CANDIDATE_DIR="$(cd "$CANDIDATE_DIR" && pwd)"
node release.mjs check-metadata
npm --prefix create-frontron run build
npm --prefix frontron run build
(cd create-frontron && npm pack --ignore-scripts --json --pack-destination "$CANDIDATE_DIR") > "$CANDIDATE_DIR/create-pack.json"
(cd frontron && npm pack --ignore-scripts --json --pack-destination "$CANDIDATE_DIR") > "$CANDIDATE_DIR/frontron-pack.json"
git rev-parse HEAD > "$CANDIDATE_DIR/source-commit.txt"
git status --short
```

Stop on unexpected source changes. Inspect the `files`, `filename` and
`integrity` fields in both pack JSON files. Require `dist` and the starter
`template`; exclude secrets, test reports and local runtime profiles. The
explicit builds matter: `npm pack --ignore-scripts` does not run a build hook.

To try this checkout before publication, use the exact absolute tarball paths
reported above. These commands run in a separate temporary consumer directory:

```text
npm exec --yes --package /absolute/path/create-frontron-VERSION.tgz -- create-frontron test-app
```

For a disposable copy of an existing web project, install **both local
tarballs** together before invoking Frontron, so the exact template dependency
does not come from an older registry build:

```text
npm install -D /absolute/path/create-frontron-VERSION.tgz /absolute/path/frontron-VERSION.tgz
npx frontron init --dry-run
```

Continue through init, development, packaging, update and clean for the selected
support scope. The CI consumers already test this local-tarball approach.

## 4. Explicit publication only

**This section changes the public npm registry.** Run it only after publication
approval, with authenticated package-owner access and the registry's required
authentication. Do not put tokens or one-time codes in Git, logs or examples.
Check `npm whoami`, `npm config get registry`, both packages' published versions
and current dist-tags. Network/authentication errors are not proof that a
version is unused. Save the old tag values in the release record.

Publish the two reviewed tarballs to the `candidate` tag, **create-frontron
first**, then Frontron. `candidate` is an npm distribution tag, not a prerelease
version and not a private staging area; its packages are public and immutable.
A plain version can satisfy semver ranges immediately even before the latest
tag moves; candidate is not an isolation boundary.
Use an explicit registry for every command:

```text
npm publish /absolute/path/create-frontron-VERSION.tgz --tag candidate --access public --registry=https://registry.npmjs.org
npm publish /absolute/path/frontron-VERSION.tgz --tag candidate --access public --registry=https://registry.npmjs.org
```

Confirm the matching dependency, fetch each version's `dist.integrity`, and
compare it to the retained pack JSON. Test fresh **registry-only** consumers of
the exact version without local links/tarballs. This post-publication check is
separate from the source CI; do not mark it complete before publication.

Only after both packages pass, promote the exact versions:

```text
npm dist-tag add create-frontron@VERSION latest --registry=https://registry.npmjs.org
npm dist-tag add frontron@VERSION latest --registry=https://registry.npmjs.org
```

Stop if either publication fails; do not promote a partial pair. The two
publications and tag changes are not atomic. When retrying, check the registry
first and never attempt to replace published bytes. A changed artifact needs a
new version and a new validation cycle. Check both final tags explicitly; a
`candidate` publication is not a completed `latest` release. `npm dist-tag`
changes have no dry-run protection.

Finally record version, source SHA, tarball integrity, registry checks and CI
URLs in the release notes. Create the Git tag/release only for that recorded
source. Keep unsupported configurations and old-schema rejection visible.

References: [npm publish](https://docs.npmjs.com/cli/v10/commands/npm-publish/),
[npm pack](https://docs.npmjs.com/cli/v10/commands/npm-pack/),
[npm dist-tag](https://docs.npmjs.com/cli/v10/commands/npm-dist-tag/).
