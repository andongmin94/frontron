import fs from "node:fs";

const createPkg = JSON.parse(fs.readFileSync("./package.json", "utf-8"));
const frontronPkgPath = "../frontron/package.json";

const frontronPkg = JSON.parse(fs.readFileSync(frontronPkgPath, "utf-8"));
frontronPkg.version = createPkg.version;

fs.writeFileSync(frontronPkgPath, JSON.stringify(frontronPkg, null, 2) + "\n");
console.log(`🔄 frontron 버전을 ${createPkg.version}로 동기화 완료!`);
