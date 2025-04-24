import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const command = process.argv[2]
const extraArgs = process.argv.slice(3)

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    ...options,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

const binPackages = {
  tsc: "typescript",
}

function resolveBin(name) {
  const packageName = binPackages[name] ?? name
  const packageJsonPath = join(
    root,
    "node_modules",
    packageName,
    "package.json"
  )

  if (!existsSync(packageJsonPath)) {
    console.error(
      `[tasks] Missing dependency for "${name}". Run npm install first.`
    )
    process.exit(1)
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
  const bin =
    typeof packageJson.bin === "string"
      ? packageJson.bin
      : (packageJson.bin?.[name] ?? packageJson.bin?.[packageName])

  if (!bin) {
    console.error(
      `[tasks] Package "${packageName}" does not expose a "${name}" binary.`
    )
    process.exit(1)
  }

  return join(root, "node_modules", packageName, bin)
}

function runBin(name, args = []) {
  runNode([resolveBin(name), ...args])
}

function runNode(args = []) {
  run(process.execPath, args)
}

function alignObjectSection(lines, sectionName) {
  const start = lines.findIndex((line) => line === `  "${sectionName}": {`)

  if (start === -1) {
    return
  }

  let end = start + 1

  while (end < lines.length && !/^  }[,]?$/.test(lines[end])) {
    end += 1
  }

  const entryIndexes = []
  let longestKey = 0

  for (let index = start + 1; index < end; index += 1) {
    const match = lines[index].match(/^    ("(?:\\.|[^"])+"):\s(.*)$/)

    if (!match) {
      continue
    }

    entryIndexes.push({ index, key: match[1], value: match[2] })
    longestKey = Math.max(longestKey, match[1].length)
  }

  for (const entry of entryIndexes) {
    lines[entry.index] = `    ${entry.key.padEnd(longestKey)} : ${entry.value}`
  }
}

function formatPackageJson() {
  const packageJsonPath = join(root, "package.json")
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
  const lines = JSON.stringify(packageJson, null, 2).split("\n")

  for (const sectionName of ["scripts", "dependencies", "devDependencies"]) {
    alignObjectSection(lines, sectionName)
  }

  writeFileSync(packageJsonPath, `${lines.join("\n")}\n`, "utf8")
}

function runLint() {
  runBin("oxlint", ["--fix", "src", "vite.config.ts"])
  runBin("oxfmt", ["src", "scripts", "vite.config.ts", "package.json"])
  formatPackageJson()
}

switch (command) {
  case "dev":
    runBin("vite", extraArgs)
    break
  case "app":
    runNode([
      "--no-deprecation",
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
    runBin("electron-builder", extraArgs)
    break
  case "lint":
    runLint()
    break
  case "format-package-json":
    formatPackageJson()
    break
  default:
    console.error(`[tasks] Unknown command: ${command ?? "(missing)"}`)
    process.exit(1)
}
