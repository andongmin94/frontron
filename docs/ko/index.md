---
layout: home

title: 프론트론
titleTemplate: Framework-First 데스크톱 앱

hero:
  name: Frontron
  text: 기존 웹 앱을 framework-first 계약으로 데스크톱 앱처럼 실행하세요
  tagline: "`frontron` 을 설치하고 `frontron.config.ts` 를 만든 뒤 `app:dev` 와 `app:build` 를 실행하세요."
  image:
    src: /logo.svg
    alt: Frontron
  actions:
    - theme: brand
      text: 빠른 시작
      link: /ko/guide/
    - theme: alt
      text: 기존 프로젝트 매뉴얼
      link: /ko/guide/install-existing-project
    - theme: alt
      text: GitHub
      link: https://github.com/andongmin94/frontron

features:
  - title: 기존 프로젝트에 설치하기
    details: 이미 있는 웹 앱에 Frontron 을 넣고 루트 config 를 만든 뒤 데스크톱 모드로 실행합니다.
    link: /ko/guide/install-existing-project
    linkText: 매뉴얼 열기
  - title: 브리지 흐름 이해하기
    details: 먼저 간단한 구조를 이해하세요. 프론트엔드는 `frontron/client` 를 호출하고, 데스크톱 쪽 코드는 Frontron 이 실행합니다.
    link: /ko/guide/understand-bridge-flow
    linkText: 설명 열기
  - title: 새 프로젝트 시작하기
    details: 공식 스타터를 생성하고 데스크톱 앱을 실행한 뒤 첫 화면 변경까지 진행합니다.
    link: /ko/guide/create-project
    linkText: 스타터 가이드 열기
  - title: 빌드와 패키징
    details: "`app:build` 가 무엇을 준비하는지와 결과물이 어디에 생기는지 확인합니다."
    link: /ko/guide/build-and-package
    linkText: 빌드 가이드 열기

---

## 자신에게 맞는 시작 경로를 고르세요

## 브리지가 어렵게 느껴진다면

먼저 아래 두 문서부터 보세요.

1. [브리지 흐름 이해하기](/ko/guide/understand-bridge-flow)
2. [데스크톱 브리지 사용하기](/ko/guide/use-bridge)

### 이미 웹 앱이 있다면

1. [기존 프로젝트에 설치하기](/ko/guide/install-existing-project)
2. [브리지 흐름 이해하기](/ko/guide/understand-bridge-flow)
3. [개발 모드로 실행하기](/ko/guide/run-development)
4. [데스크톱 브리지 사용하기](/ko/guide/use-bridge)
5. [빌드와 패키징](/ko/guide/build-and-package)

### 새 스타터 프로젝트가 필요하다면

1. [프로젝트 만들기](/ko/guide/create-project)
2. [개발 모드로 실행하기](/ko/guide/run-development)
3. [앱 이름과 아이콘 바꾸기](/ko/guide/customize-app)
4. [생성된 구조 이해하기](/ko/guide/understand-template)

## Frontron 이 소유하는 것

- config discovery 와 `frontron` CLI
- Electron runtime 과 packaging 흐름
- `frontron/client` 를 통한 데스크톱 브리지
- `frontron/rust` 의 공식 Rust 슬롯

## 먼저 보기 좋은 매뉴얼

- [빠른 시작](/ko/guide/)
- [기존 프로젝트에 설치하기](/ko/guide/install-existing-project)
- [브리지 흐름 이해하기](/ko/guide/understand-bridge-flow)
- [데스크톱 브리지 사용하기](/ko/guide/use-bridge)
- [문제 해결](/ko/guide/troubleshooting)
