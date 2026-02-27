import fs from "node:fs";

const createPkg = JSON.parse(fs.readFileSync("./package.json", "utf8"));
const frontronPkgPath = "../frontron/package.json";
const templatePackagePaths = [
  "./template-react/package.json",
  "./template-next/package.json",
];

const frontronPkg = JSON.parse(fs.readFileSync(frontronPkgPath, "utf8"));
frontronPkg.version = createPkg.version;
fs.writeFileSync(frontronPkgPath, `${JSON.stringify(frontronPkg, null, 2)}\n`);

for (const templatePkgPath of templatePackagePaths) {
  const templatePkg = JSON.parse(fs.readFileSync(templatePkgPath, "utf8"));
  templatePkg.dependencies = templatePkg.dependencies ?? {};
  templatePkg.dependencies.frontron = `^${createPkg.version}`;
  fs.writeFileSync(templatePkgPath, `${JSON.stringify(templatePkg, null, 2)}\n`);
}

console.log(`Synced frontron version to ${createPkg.version}`);
console.log(
  `Synced template dependencies to frontron@^${createPkg.version} (${templatePackagePaths.length} templates)`,
);
