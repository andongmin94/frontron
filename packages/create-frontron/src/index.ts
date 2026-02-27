import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import minimist from "minimist";
import prompts from "prompts";
import { cyan, red, reset, white } from "kolorist";

type ColorFn = (str: string | number) => string;

type Framework = {
  name: string;
  display: string;
  color: ColorFn;
  templateDir: string;
};

const FRAMEWORKS: Framework[] = [
  {
    name: "react",
    display: "React",
    color: cyan,
    templateDir: "template-react",
  },
  {
    name: "next",
    display: "Next.js",
    color: white,
    templateDir: "template-next",
  },
];

const TEMPLATE_NAMES = new Set(FRAMEWORKS.map((framework) => framework.name));

const argv = minimist<{
  t?: string | boolean;
  template?: string | boolean;
}>(process.argv.slice(2), { string: ["_"] });

const cwd = process.cwd();

const renameFiles: Record<string, string | undefined> = {
  _gitignore: ".gitignore",
};

const defaultTargetDir = "frontron";

function parseTemplateArg(value: string | boolean | undefined) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

async function init() {
  const argTargetDir = formatTargetDir(argv._[0]);
  const argTemplate = parseTemplateArg(argv.template ?? argv.t);

  let targetDir = argTargetDir || defaultTargetDir;
  const getProjectName = () =>
    targetDir === "." ? path.basename(path.resolve()) : targetDir;

  let result: prompts.Answers<
    "projectName" | "overwrite" | "packageName" | "framework"
  >;

  prompts.override({
    overwrite: argv.overwrite,
  });

  try {
    result = await prompts(
      [
        {
          type: argTargetDir ? null : "text",
          name: "projectName",
          message: reset("Project name:"),
          initial: defaultTargetDir,
          onState: (state) => {
            targetDir = formatTargetDir(state.value) || defaultTargetDir;
          },
        },
        {
          type: () =>
            !fs.existsSync(targetDir) || isEmpty(targetDir) ? null : "select",
          name: "overwrite",
          message: () =>
            (targetDir === "."
              ? "Current directory"
              : `Target directory "${targetDir}"`) +
            " is not empty. Please choose how to proceed:",
          initial: 0,
          choices: [
            {
              title: "Remove existing files and continue",
              value: "yes",
            },
            {
              title: "Cancel operation",
              value: "no",
            },
            {
              title: "Ignore files and continue",
              value: "ignore",
            },
          ],
        },
        {
          type: (_, { overwrite }: { overwrite?: string }) => {
            if (overwrite === "no") {
              throw new Error(red("x") + " Operation cancelled");
            }
            return null;
          },
          name: "overwriteChecker",
        },
        {
          type: () => (isValidPackageName(getProjectName()) ? null : "text"),
          name: "packageName",
          message: reset("Package name:"),
          initial: () => toValidPackageName(getProjectName()),
          validate: (dir) =>
            isValidPackageName(dir) || "Invalid package.json name",
        },
        {
          type: argTemplate && TEMPLATE_NAMES.has(argTemplate) ? null : "select",
          name: "framework",
          message:
            typeof argTemplate === "string" && !TEMPLATE_NAMES.has(argTemplate)
              ? reset(
                  `"${argTemplate}" isn't a valid template. Please choose from below:`,
                )
              : reset("Select a framework:"),
          initial: 0,
          choices: FRAMEWORKS.map((framework) => ({
            title: framework.color(framework.display),
            value: framework.name,
          })),
        },
      ],
      {
        onCancel: () => {
          throw new Error(red("x") + " Operation cancelled");
        },
      },
    );
  } catch (cancelled: any) {
    console.log(cancelled.message);
    return;
  }

  const { framework, overwrite, packageName } = result;
  const selectedTemplate =
    framework ||
    (argTemplate && TEMPLATE_NAMES.has(argTemplate) ? argTemplate : undefined) ||
    FRAMEWORKS[0].name;
  const selectedFramework =
    FRAMEWORKS.find((item) => item.name === selectedTemplate) || FRAMEWORKS[0];

  const root = path.join(cwd, targetDir);

  if (overwrite === "yes") {
    emptyDir(root);
  } else if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }

  const pkgInfo = pkgFromUserAgent(process.env.npm_config_user_agent);
  const pkgManager = pkgInfo ? pkgInfo.name : "npm";

  console.log(`\nScaffolding project in ${root}...`);

  const templateDir = path.resolve(
    fileURLToPath(import.meta.url),
    "../..",
    selectedFramework.templateDir,
  );

  if (!fs.existsSync(templateDir)) {
    throw new Error(
      `Template directory not found: "${selectedFramework.templateDir}"`,
    );
  }

  const write = (file: string, content?: string) => {
    const targetPath = path.join(root, renameFiles[file] ?? file);
    if (content) {
      fs.writeFileSync(targetPath, content);
    } else {
      copy(path.join(templateDir, file), targetPath);
    }
  };

  const files = fs.readdirSync(templateDir);
  for (const file of files.filter((f) => f !== "package.json")) {
    write(file);
  }

  const pkg = JSON.parse(
    fs.readFileSync(path.join(templateDir, "package.json"), "utf-8"),
  );

  pkg.name = packageName || getProjectName();
  if (pkg.build) {
    pkg.build.appId = pkg.name;
    pkg.build.productName = pkg.name;
  }

  write("package.json", `${JSON.stringify(pkg, null, 2)}\n`);

  const cdProjectName = path.relative(cwd, root);
  console.log("\nDone. Now run:\n");
  if (root !== cwd) {
    console.log(
      `  cd ${
        cdProjectName.includes(" ") ? `"${cdProjectName}"` : cdProjectName
      }`,
    );
  }
  switch (pkgManager) {
    case "yarn":
      console.log("  yarn");
      console.log("  yarn app");
      break;
    default:
      console.log(`  ${pkgManager} install`);
      console.log(`  ${pkgManager} run app`);
      break;
  }
  console.log();
}

function formatTargetDir(targetDir: string | undefined) {
  return targetDir?.trim().replace(/\/+$/g, "");
}

function copy(src: string, dest: string) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    copyDir(src, dest);
  } else {
    fs.copyFileSync(src, dest);
  }
}

function isValidPackageName(projectName: string) {
  return /^(?:@[a-z\d\-*~][a-z\d\-*._~]*\/)?[a-z\d\-~][a-z\d\-._~]*$/.test(
    projectName,
  );
}

function toValidPackageName(projectName: string) {
  return projectName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/^[._]/, "")
    .replace(/[^a-z\d\-~]+/g, "-");
}

function copyDir(srcDir: string, destDir: string) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of fs.readdirSync(srcDir)) {
    const srcFile = path.resolve(srcDir, file);
    const destFile = path.resolve(destDir, file);
    copy(srcFile, destFile);
  }
}

function isEmpty(dirPath: string) {
  const files = fs.readdirSync(dirPath);
  return files.length === 0 || (files.length === 1 && files[0] === ".git");
}

function emptyDir(dir: string) {
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const file of fs.readdirSync(dir)) {
    if (file === ".git") {
      continue;
    }
    fs.rmSync(path.resolve(dir, file), { recursive: true, force: true });
  }
}

function pkgFromUserAgent(userAgent: string | undefined) {
  if (!userAgent) return undefined;
  const pkgSpec = userAgent.split(" ")[0];
  const pkgSpecArr = pkgSpec.split("/");
  return {
    name: pkgSpecArr[0],
    version: pkgSpecArr[1],
  };
}

init().catch((error) => {
  console.error(error);
});
