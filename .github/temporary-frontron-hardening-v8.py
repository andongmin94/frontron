from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / 'scripts/package-manager-smoke.mjs'
source = path.read_text(encoding='utf-8')

old = """  npx(
    "pnpm@11.11.0",
    "pnpm",
    ["exec", "frontron", "init", "--yes", "--adapter", "generic-static", "--out-dir", "dist"],
    pnpmRetrofitRoot
  )
  npx("pnpm@11.11.0", "pnpm", ["exec", "frontron", "doctor"], pnpmRetrofitRoot)
"""
new = """  npx(
    "pnpm@11.11.0",
    "pnpm",
    ["exec", "frontron", "init", "--yes", "--adapter", "generic-static", "--out-dir", "dist"],
    pnpmRetrofitRoot
  )
  npx(
    "pnpm@11.11.0",
    "pnpm",
    ["install", "--no-frozen-lockfile", "--ignore-scripts"],
    pnpmRetrofitRoot
  )
  npx("pnpm@11.11.0", "pnpm", ["exec", "frontron", "doctor"], pnpmRetrofitRoot)
"""
if source.count(old) != 1:
    raise RuntimeError('pnpm retrofit lifecycle insertion point was not found')
source = source.replace(old, new, 1)
path.write_text(source, encoding='utf-8')

for relative_path in (
    '.github/temporary-frontron-hardening-v8.py',
    '.github/workflows/temporary-frontron-hardening-v8.yml',
    '.github/workflows/temporary-package-manager-diagnostic.yml',
):
    (ROOT / relative_path).unlink(missing_ok=True)
