import fs from "fs";

const createPkg = JSON.parse(fs.readFileSync("./package.json", "utf-8"));
const frontronPkgPath = "../frontron/package.json"; // frontron 위치에 따라 수정

const frontronPkg = JSON.parse(fs.readFileSync(frontronPkgPath, "utf-8"));
frontronPkg.version = createPkg.version; // 버전 동기화

fs.writeFileSync(frontronPkgPath, JSON.stringify(frontronPkg, null, 2) + "\n");
console.log(`🔄 frontron 버전을 ${createPkg.version}로 동기화 완료!`);
