import fs from "node:fs";

const createPkg = JSON.parse(fs.readFileSync("./package.json", "utf8"));
const frontronPkgPath = "../frontron/package.json";
const templatePkgPath = "./template-react/package.json";

const frontronPkg = JSON.parse(fs.readFileSync(frontronPkgPath, "utf8"));
frontronPkg.version = createPkg.version;
fs.writeFileSync(frontronPkgPath, `${JSON.stringify(frontronPkg, null, 2)}\n`);

const templatePkg = JSON.parse(fs.readFileSync(templatePkgPath, "utf8"));
templatePkg.dependencies = templatePkg.dependencies ?? {};
templatePkg.dependencies.frontron = `^${createPkg.version}`;
fs.writeFileSync(templatePkgPath, `${JSON.stringify(templatePkg, null, 2)}\n`);

console.log(`Synced frontron version to ${createPkg.version}`);
console.log(`Synced template dependency frontron@^${createPkg.version}`);