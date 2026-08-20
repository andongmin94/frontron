import { readFileSync, writeFileSync } from 'node:fs'

function update(path, replacements) {
  let source = readFileSync(path, 'utf8')

  for (const [before, after, expectedCount] of replacements) {
    const count = source.split(before).length - 1

    if (count !== expectedCount) {
      throw new Error(`${path}: expected ${expectedCount} occurrence(s), found ${count}: ${before}`)
    }

    source = source.split(before).join(after)
  }

  writeFileSync(path, source)
}

update('create-frontron/scripts/release-matrix-smoke.mjs', [
  [
    "runNpm(['run', 'frontron:package', '--', '--dir'], appRoot)",
    "runNpm(['run', 'frontron:build', '--', '--dir'], appRoot)",
    1,
  ],
])

update('create-frontron/scripts/package-manager-matrix-smoke.mjs', [
  ['frontron:package --dir까지 실행한다.', 'frontron:build --dir까지 실행한다.', 1],
  [
    "for (const scriptName of ['frontron:dev', 'frontron:build', 'frontron:package'])",
    "for (const scriptName of ['frontron:dev', 'frontron:build'])",
    1,
  ],
  ["      'frontron:package',", "      'frontron:build',", 1],
])
