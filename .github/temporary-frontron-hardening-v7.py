from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / 'scripts/package-manager-smoke.mjs'
source = path.read_text(encoding='utf-8')

old_error = """  if (result.status !== 0) {
    throw new Error(result.error?.message || result.stderr || result.stdout || `${command} failed`)
  }
"""
new_error = """  if (result.status !== 0) {
    const details = [result.error?.message, result.stdout, result.stderr]
      .filter(Boolean)
      .join('\\n')
    throw new Error(details || `${command} failed`)
  }
"""
if source.count(old_error) != 1:
    raise RuntimeError('package-manager smoke error handler was not found')
source = source.replace(old_error, new_error, 1)

old_package = """    devDependencies: {
      "create-frontron": `file:${createTarball}`,
      frontron: `file:${frontronTarball}`,
      vite: "^8.0.1",
    },
    pnpm: { overrides: { "create-frontron": `file:${createTarball}` } },
  })
  npx("pnpm@11.11.0", "pnpm", ["install", "--ignore-scripts"], pnpmRetrofitRoot)
"""
new_package = """    devDependencies: {
      "create-frontron": `file:${createTarball}`,
      frontron: `file:${frontronTarball}`,
      vite: "^8.0.1",
    },
  })
  writeFileSync(
    join(pnpmRetrofitRoot, "pnpm-workspace.yaml"),
    `overrides:\\n  create-frontron: ${JSON.stringify(`file:${createTarball}`)}\\n`,
    "utf8",
  )
  npx("pnpm@11.11.0", "pnpm", ["install", "--ignore-scripts"], pnpmRetrofitRoot)
"""
if source.count(old_package) != 1:
    raise RuntimeError('legacy pnpm override smoke setup was not found')
source = source.replace(old_package, new_package, 1)
path.write_text(source, encoding='utf-8')

for relative_path in (
    '.github/temporary-frontron-hardening-v7.py',
    '.github/workflows/temporary-frontron-hardening-v7.yml',
):
    (ROOT / relative_path).unlink(missing_ok=True)
