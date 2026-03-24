# 빌드와 패키징

개발 모드가 정상 동작했다면 다음 단계는 배포 가능한 결과물을 만드는 것입니다.

이 페이지는 `npm run app:build` 가 무엇을 하는지, 어떤 제품 결정이 아직 설정 가능하고, 결과물이 어디에 생기는지 설명합니다.

## 1. 명령

```bash
npm run app:build
```

이 명령은 아래를 실행합니다.

```bash
frontron build
```

일부 스타터에서는 `npm run build` 가 `npm run app:build` 로 연결되기도 합니다.

## 2. 빌드 중에는 무엇이 일어나나?

빌드 흐름은 아래와 같습니다.

1. 렌더러 결과물을 빌드합니다.
2. `.frontron/` 아래에 런타임 파일을 스테이징합니다.
3. 데스크톱 앱을 패키징합니다.

런타임과 패키징 파이프라인은 여전히 복사된 템플릿 파일이 아니라 `frontron` 이 소유합니다.

## 3. 빌드 전에 확인하면 좋은 것

- `npm run app:dev` 가 최소 한 번은 정상 동작했는지 확인합니다.
- 아이콘, 앱 메타데이터, 빌드 정책 변경 사항을 저장합니다.
- 터미널에 이미 떠 있는 런타임 오류가 없는지 확인합니다.

## 4. `frontron.config.ts` 에서 바꿀 수 있는 대표 패키징 옵션

일반적인 제품 패키징 결정은 `build` 블록에 둡니다.

```ts
import { defineConfig } from 'frontron'

export default defineConfig({
  app: {
    name: 'My App',
    id: 'com.example.myapp',
    description: 'Desktop build for My App',
    author: 'My Team',
    copyright: 'Copyright 2026 My Team',
  },
  build: {
    outputDir: 'release',
    artifactName: '${productName}-${version}-${target}.${ext}',
    asar: true,
    compression: 'maximum',
    extraResources: ['resources'],
    extraFiles: [{ from: 'licenses', to: 'licenses' }],
    windows: {
      targets: ['portable', 'dir'],
      requestedExecutionLevel: 'highestAvailable',
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
    },
    mac: {
      targets: ['dmg', 'zip'],
      category: 'public.app-category.developer-tools',
    },
    linux: {
      targets: ['AppImage', 'deb'],
      category: 'Development',
      packageCategory: 'devel',
    },
  },
})
```

이번 단계에서 공식적으로 연 대표 필드는 아래입니다.

- `app.description`
- `app.author`
- `app.copyright`
- `build.outputDir`
- `build.artifactName`
- `build.asar`
- `build.compression`
- `build.files`
- `build.extraResources`
- `build.extraFiles`
- `build.windows.targets`
- `build.windows.icon`
- `build.windows.publisherName`
- `build.windows.signAndEditExecutable`
- `build.windows.requestedExecutionLevel`
- `build.windows.artifactName`
- `build.nsis.oneClick`
- `build.nsis.perMachine`
- `build.nsis.allowToChangeInstallationDirectory`
- `build.nsis.deleteAppDataOnUninstall`
- `build.nsis.installerIcon`
- `build.nsis.uninstallerIcon`
- `build.mac.targets`
- `build.mac.icon`
- `build.mac.category`
- `build.mac.artifactName`
- `build.linux.targets`
- `build.linux.icon`
- `build.linux.category`
- `build.linux.packageCategory`
- `build.linux.artifactName`

경로 기반 값인 `build.extraResources`, `build.extraFiles`, `build.windows.icon`, `build.nsis.installerIcon` 은 프로젝트 루트 기준으로 해석합니다.

`build.mac.icon`, `build.linux.icon` 도 같은 방식으로 프로젝트 루트 기준 경로입니다.

반대로 `build.files` 는 스테이징된 패키지 앱 내용을 필터링하는 패턴이라서, 스테이지 앱 루트 기준으로 적어야 합니다.

## 5. Windows 에서 어떤 결과를 기대해야 하나?

기본 설정에서는 패키징 결과물이 `output/` 아래에 생성됩니다.

`build.outputDir` 를 설정했다면 그 폴더를 확인하면 됩니다.

기본 Windows 타깃 설정에서는 보통 아래 결과물을 보게 됩니다.

- `win-unpacked/`
- 설치용 `.exe`

`build.windows.targets` 를 바꾸면 결과물 형태도 바뀝니다.

예:

- `['portable']`: 포터블 `.exe`
- `['dir']`: unpacked 앱만 생성
- `['portable', 'dir']`: 포터블과 unpacked 둘 다 생성

정확한 파일 이름은 `app.name`, 앱 버전, `build.artifactName` 값에 따라 달라질 수 있습니다.

## 6. 빌드 후에는 어디를 보면 되나?

먼저 아래 폴더를 보면 됩니다.

```text
dist/
.frontron/
output/
```

- `dist/`: 빌드된 웹 프론트엔드
- `.frontron/`: Frontron 스테이징과 생성 파일
- `output/`: 기본 패키징 결과물

`build.outputDir` 를 설정했다면 `output/` 대신 그 경로를 확인하면 됩니다.

::: tip
빌드는 성공했는데 폴더 구조가 헷갈린다면 다음 페이지를 보고 각 폴더를 하나씩 확인하세요.
:::

::: warning
Windows 에서는 프로젝트 경로가 너무 길면 패키징 단계가 깨질 수 있습니다. 긴 경로 안쪽에서 파일을 찾지 못하는 오류가 보이면 `C:\dev\my-app` 같은 짧은 경로에서 다시 빌드해 보세요.
:::
