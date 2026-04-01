# 지원 범위 표

이 페이지는 `frontron` CLI/runtime support package의 지원 범위를 정리한 문서입니다.

`create-frontron`으로 스타터를 만든 뒤 보거나, 기존 웹앱에 `frontron init`으로 데스크톱 레이어를 붙일 때 참고하면 됩니다.

핵심은 단순합니다. 어떤 데스크톱 surface를 `frontron`이 대신 소유하는지, 어떤 값이 일반 설정 경로인지, 어떤 값이 아직 guarded 인지만 먼저 명확히 보여 주는 문서입니다.

## 1. 일반 `frontron.config.ts` surface

아래 영역은 스타터 프로젝트와 호환 수동 설치 경로에서 공통으로 쓰는 일반 설정입니다.

| 영역 | 주요 필드 | 설명 |
| --- | --- | --- |
| 앱 메타데이터 | `app.name`, `app.id`, `app.icon`, `app.description`, `app.author`, `app.copyright` | 데스크톱 앱 식별 정보 |
| 웹 연결 | `web.dev.command`, `web.dev.url`, `web.build.command`, `web.build.outDir` | 자동 추론이 부족할 때 명시 |
| 빌드 정책 | `build.outputDir`, `build.artifactName`, `build.publish`, `build.asar`, `build.compression`, `build.files`, `build.extraResources`, `build.extraFiles` | 일반적인 패키징 결정 |
| 플랫폼 패키징 | `build.windows.*`, `build.nsis.*`, `build.mac.*`, `build.linux.*` | 플랫폼별 일반 패키징 선택 |
| 파일 연결 | `build.fileAssociations[]` | 패키징된 문서 타입 등록 |
| 창 설정 | `windows.*` 공통 창 필드 | 스타터와 수동 설치가 같은 창 entrypoint 사용 |
| 안전한 런타임 튜닝 | `windows.*.zoomFactor`, `windows.*.sandbox`, `windows.*.spellcheck`, `windows.*.webSecurity` | 작은 안전 subset만 공식 지원 |
| 업데이트 | `updates.enabled`, `updates.provider`, `updates.url`, `updates.checkOnLaunch` | 의도적으로 작은 지원 범위 |
| 딥링크 | `deepLinks.enabled`, `deepLinks.name`, `deepLinks.schemes` | 스킴 등록과 런타임 URL 수신 |
| 보안 정책 | `security.externalNavigation`, `security.newWindow` | 외부 이동 정책만 우선 지원 |
| 앱 레이어 모듈 | `bridge`, `menu`, `tray`, `hooks`, `rust` | `frontron/`에서 설정하지만 런타임 소유권은 `frontron`에 있음 |

## 2. guarded advanced-only 필드

아래 surface는 일반 설정만으로 부족할 때만 쓰는 예외 경로입니다.

| surface | 용도 | 계속 막는 것 |
| --- | --- | --- |
| `build.advanced.electronBuilder` | 마지막 단계 패키징 예외 처리 | `frontron` 소유 경로, package entry 연결, typed packaging 필드, raw `protocols`, raw `fileAssociations` |
| `windows.*.advanced` | 마지막 단계 `BrowserWindow` 예외 처리 | `webPreferences`, 아이콘 연결, typed window 필드 |

`advanced` 는 메인 경로가 아니라 best-effort escape hatch 입니다.

가능하면 항상 typed `build.*`, `windows.*` 부터 쓰는 편이 맞습니다.

## 3. 런타임 소유로 닫아 둔 필드

아래 값은 `frontron`이 런타임 wiring, preload wiring, staging, packaging을 소유하기 때문에 의도적으로 닫아 둡니다.

| 닫힌 영역 | 닫아 두는 이유 |
| --- | --- |
| `preload` 경로 | preload 연결은 Frontron이 소유 |
| `contextIsolation` | bridge 보안 경계를 Frontron이 고정 |
| `nodeIntegration` | renderer 보안 기본값을 Frontron이 고정 |
| raw `session` / `partition` | 아직 typed surface 밖 |
| 스테이징 경로와 생성 런타임 레이아웃 | 빌드 staging은 Frontron 소유 |
| 템플릿 내부 Electron 코어 로직 | `create-frontron` 은 템플릿 생성기 역할에 머물러야 함 |
| `window.electron` 식 renderer 전역 | 공개 renderer 계약은 계속 `frontron/client` 하나 |

## 4. 프론트엔드 스택 지원 범위

현재 스타터 프로젝트와 호환 수동 설치 기준의 지원 상태는 아래와 같습니다.

| 스택 | dev 추론 | build 추론 | 메모 |
| --- | --- | --- | --- |
| Vite | 예 | 예 | 기본 스타터 구조이자 가장 잘 맞는 경로 |
| React with Vite | 예 | 예 | Vite와 동일 |
| Vue with Vite | 예 | 예 | Vite와 동일 |
| VitePress | 예 | 예 | `docs:dev`, `docs:build` 구조 지원 |
| Astro | 예 | 예 | 정적 출력 경로 지원 |
| Angular CLI | 예 | 예 | 현재 Angular `dist/<app>/browser` 경로 지원 |
| Next.js | 예 | 조건부 | static export 흐름 기준 |
| Nuxt | 예 | 조건부 | generate / prerender 흐름 기준 |
| 모노레포 앱 | 경우에 따라 | 경우에 따라 | 보통 `web.dev`, `web.build` 명시 권장 |
| 래퍼 스크립트 | 경우에 따라 | 경우에 따라 | 추론이 애매하면 `web.*` 명시 권장 |

## 5. 자동 추론을 멈추고 명시 설정으로 넘어갈 때

아래 경우에는 `web.dev`, `web.build` 를 직접 적는 편이 맞습니다.

- `turbo run dev --filter web` 같은 래퍼 스크립트를 쓸 때
- 저장소 안에 프론트엔드 앱이 여러 개 있을 때
- 정적 출력 경로가 바로 보이지 않을 때
- 팀에서 데스크톱 연결 경로를 완전히 명시적으로 관리하고 싶을 때

`create-frontron` 으로 시작했다면 한동안은 자동 추론 경로를 그대로 써도 되는 경우가 많습니다.

기존 프론트엔드를 붙이는 경로에서 확신이 없으면 먼저 아래를 실행하면 됩니다.

```bash
npx frontron check
```

그 다음 이 레시피 문서에서 해당 스택 예시를 그대로 따라가면 됩니다.
