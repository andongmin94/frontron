import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const command = process.argv[2]
const extraArgs = process.argv.slice(3)
const formatTargets = ["src", "scripts", "vite.config.ts", "package.json"]

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    ...options,
  })

  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const binPackages = { tsc: "typescript" }

function resolveBin(name) {
  const packageName = binPackages[name] ?? name
  const packageJsonPath = join(root, "node_modules", packageName, "package.json")
  if (!existsSync(packageJsonPath)) {
    console.error(`[tasks] Missing dependency for "${name}". Run install first.`)
    process.exit(1)
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
  const bin =
    typeof packageJson.bin === "string"
      ? packageJson.bin
      : (packageJson.bin?.[name] ?? packageJson.bin?.[packageName])
  if (!bin) {
    console.error(`[tasks] Package "${packageName}" does not expose a "${name}" binary.`)
    process.exit(1)
  }
  return join(root, "node_modules", packageName, bin)
}

function runNode(args = []) {
  run(process.execPath, args)
}

function runBin(name, args = []) {
  runNode([resolveBin(name), ...args])
}

function getElectronBuilderArgs(args) {
  const hasExplicitPublish = args.some(
    (argument) => argument === "--publish" || argument.startsWith("--publish=")
  )
  return hasExplicitPublish ? args : ["--publish", "never", ...args]
}

switch (command) {
  case "dev":
    runBin("vite", extraArgs)
    break
  case "app":
    runNode([
      "--no-deprecation",
      "--disable-warning=ExperimentalWarning",
      "--experimental-strip-types",
      "src/electron/serve.ts",
      "--dev-app",
      ...extraArgs,
    ])
    break
  case "typecheck":
    runBin("tsc", ["-b"])
    runBin("tsc", ["-p", "tsconfig.electron.json"])
    break
  case "build":
    runBin("tsc", ["-b"])
    runBin("vite", ["build"])
    runBin("tsc", ["-p", "tsconfig.electron.json"])
    runBin("electron-builder", getElectronBuilderArgs(extraArgs))
    break
  case "lint":
    runBin("oxlint", ["src", "vite.config.ts"])
    break
  case "format":
    runBin("oxfmt", formatTargets)
    break
  case "format:check":
    runBin("oxfmt", ["--check", ...formatTargets])
    break
  default:
    console.error(`[tasks] Unknown command: ${command ?? "(missing)"}`)
    process.exit(1)
}
