from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "frontron/__tests__/package-smoke.spec.ts"
source = path.read_text(encoding="utf-8")

source = source.replace(
    "    main?: string\n    types?: string\n    dependencies?: Record<string, string>",
    "    main?: string\n    types?: string\n    exports?: Record<string, unknown>\n    dependencies?: Record<string, string>",
    1,
)
source = source.replace(
    "  expect(packageJson.main).toBe('./dist/cli.mjs')\n  expect(packageJson.types).toBe('./dist/cli.d.ts')",
    "  expect(packageJson.main).toBeUndefined()\n  expect(packageJson.types).toBeUndefined()\n  expect(packageJson.exports).toEqual({ './package.json': './package.json' })",
    1,
)
source, count = re.subn(
    r"\n    const importResult = runNode\(.*?\n    expect\(importResult\)\.toBe\('function'\)\n",
    """
    const importResult = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', "await import('frontron')"],
      { cwd: appRoot, encoding: 'utf8' },
    )
    expect(importResult.status).not.toBe(0)
""",
    source,
    count=1,
    flags=re.DOTALL,
)
if count != 1:
    raise RuntimeError("The legacy package-root import assertion was not found")

if "expect(packageJson.main).toBeUndefined()" not in source:
    raise RuntimeError("The CLI-only package metadata assertion was not applied")
if "exports?: Record<string, unknown>" not in source:
    raise RuntimeError("The package exports test type was not updated")

path.write_text(source, encoding="utf-8")

for relative_path in (
    ".github/temporary-frontron-hardening-v5.py",
    ".github/workflows/temporary-frontron-hardening-v5.yml",
):
    (ROOT / relative_path).unlink(missing_ok=True)
