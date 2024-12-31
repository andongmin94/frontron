import minimist from "minimist";

import { migrateProject } from "./migrate";

function printHelp() {
  console.log(`frontron migrate [targetDir]

Options:
  --dry-run    Show planned changes without writing files
  --force      Skip backup creation
  --help       Show this help message
`);
}

async function run() {
  const argv = minimist(process.argv.slice(2), {
    boolean: ["dry-run", "force", "help"],
    alias: {
      h: "help",
    },
  });

  const [command, maybeTargetDir] = argv._ as string[];
  const targetDir = typeof maybeTargetDir === "string" ? maybeTargetDir : process.cwd();

  if (argv.help || !command) {
    printHelp();
    return;
  }

  if (command !== "migrate") {
    throw new Error(`Unknown command: ${command}`);
  }

  const result = migrateProject({
    projectDir: targetDir,
    dryRun: argv["dry-run"],
    force: argv.force,
  });

  console.log(`[frontron] project: ${result.projectDir}`);
  console.log(`[frontron] dry-run: ${result.dryRun ? "yes" : "no"}`);
  console.log(`[frontron] template: ${result.template}`);
  if (result.backupDir) {
    console.log(`[frontron] backup: ${result.backupDir}`);
  }
  for (const filePath of result.writtenFiles) {
    console.log(`[write] ${filePath}`);
  }
  for (const filePath of result.removedFiles) {
    console.log(`[remove] ${filePath}`);
  }
}

run().catch((error) => {
  console.error(`[frontron] ${String((error as Error).message ?? error)}`);
  process.exitCode = 1;
});
