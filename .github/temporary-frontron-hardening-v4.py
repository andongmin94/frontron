from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    source = read(path)
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, found {count}")
    write(path, source.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str) -> None:
    source = read(path)
    updated, count = re.subn(pattern, replacement, source, count=1, flags=re.DOTALL)
    if count != 1:
        raise RuntimeError(f"Expected one regex match in {path}, found {count}")
    write(path, updated)


# Restore the node-server constants that the broad source rewrite intentionally repositions.
header_path = "frontron/src/init/runtime/serve-source/header-config-source.ts"
header = read(header_path)
marker = "  const nodeServerState = usesNodeServer"
if marker not in header:
    raise RuntimeError("nodeServerState insertion point was not found")
if "const nodeServerConstants = usesNodeServer" not in header:
    block = """  const nodeServerConstants = usesNodeServer
    ? `
const NODE_SERVER_SOURCE_ROOT = readEmbeddedJson<string | null>(${embedJson(config.nodeServerSourceRoot)})
const NODE_SERVER_SOURCE_ENTRY = readEmbeddedJson<string | null>(${embedJson(config.nodeServerSourceEntry ?? null)})
const NODE_SERVER_ENTRY = readEmbeddedJson<string | null>(${embedJson(config.nodeServerEntry)})
const NODE_SERVER_COPY_TARGETS = readEmbeddedJson<Array<{ from: string; to: string }>>(${embedJson(config.nodeServerCopyTargets)})`
    : ''
"""
    header = header.replace(marker, block + marker, 1)
write(header_path, header)

# Remove two implementation leftovers exposed by the stricter lint pass.
regex_once(
    "create-frontron/template/src/electron/serve.ts",
    r'\nconst loopbackHost = "127\.0\.0\.1"\n',
    "\n",
)
regex_once(
    "frontron/__tests__/package-smoke.spec.ts",
    r"\nfunction runNode\(args: string\[\], cwd: string\) \{.*?\n\}\n",
    "\n",
)

# Framework fixtures manually transpile generated files, so include the canonical static server.
replace_once(
    "frontron/__tests__/framework-fixture-smoke.spec.ts",
    """function transpileGeneratedServe(projectRoot: string) {
  const serveSource = readFileSync(join(projectRoot, 'electron', 'serve.ts'), 'utf8')
  const transpiled = ts.transpileModule(serveSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: 'serve.ts',
  })

  const distDir = join(projectRoot, 'dist-electron')
  mkdirSync(distDir, { recursive: true })
  writeFileSync(join(distDir, 'serve.js'), transpiled.outputText, 'utf8')
}
""",
    """function transpileGeneratedRuntime(projectRoot: string) {
  const sourceDir = join(projectRoot, 'electron')
  const distDir = join(projectRoot, 'dist-electron')
  mkdirSync(distDir, { recursive: true })

  for (const fileName of ['serve.ts', 'static-server.ts']) {
    const source = readFileSync(join(sourceDir, fileName), 'utf8')
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
      },
      fileName,
    })
    writeFileSync(
      join(distDir, fileName.replace(/\\.ts$/, '.js')),
      transpiled.outputText,
      'utf8',
    )
  }
}
""",
)
replace_once(
    "frontron/__tests__/framework-fixture-smoke.spec.ts",
    "  transpileGeneratedServe(projectRoot)",
    "  transpileGeneratedRuntime(projectRoot)",
)

# The virtual NodeNext compiler host needs an explicit .js -> .ts mapping.
replace_once(
    "frontron/__tests__/runtime-serve-contract.spec.ts",
    """  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const content = virtualContent(fileName)
    return content !== undefined
      ? ts.createSourceFile(fileName, content, languageVersion, true, ts.ScriptKind.TS)
      : getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
  }

  return ts.getPreEmitDiagnostics(
""",
    """  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const content = virtualContent(fileName)
    return content !== undefined
      ? ts.createSourceFile(fileName, content, languageVersion, true, ts.ScriptKind.TS)
      : getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
  }
  host.resolveModuleNames = (moduleNames, containingFile) =>
    moduleNames.map((moduleName) => {
      if (moduleName === './static-server.js') {
        return {
          resolvedFileName: join(virtualRoot, 'static-server.ts'),
          extension: ts.Extension.Ts,
          isExternalLibraryImport: false,
        }
      }

      return ts.resolveModuleName(moduleName, containingFile, compilerOptions, host)
        .resolvedModule
    })

  return ts.getPreEmitDiagnostics(
""",
)

# The final product commit must not contain automation helpers.
for relative_path in (
    ".github/temporary-frontron-hardening.py",
    ".github/temporary-frontron-hardening-v4.py",
    ".github/workflows/temporary-frontron-hardening.yml",
    ".github/workflows/temporary-frontron-hardening-v2.yml",
    ".github/workflows/temporary-frontron-hardening-v3.yml",
    ".github/workflows/temporary-frontron-hardening-v4.yml",
):
    (ROOT / relative_path).unlink(missing_ok=True)
