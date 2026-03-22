---
layout: home

title: Frontron
titleTemplate: Electron 앱 빠른 시작

hero:
  name: Frontron
  text: 기존 웹 앱을 데스크톱 앱으로 확장하는 framework-first 전환
  tagline: 공식 목표는 `frontron + frontron.config.ts + app:dev/app:build` 입니다.
  image:
    src: /logo.svg
    alt: Frontron
  actions:
    - theme: brand
      text: 빠른 시작
      link: /guide/
    - theme: alt
      text: GitHub
      link: https://github.com/andongmin94/frontron

features:
  - icon:
      dark: /npm.svg
      light: /npm.svg
      width: 150px
    title: Framework-First Contract
    linkText: npm
    link: https://npmjs.com/package/create-frontron

---

::: tip Official contract
Frontron uses a framework-first, config-driven product model.

The official contract now works in the repo as:

- install `frontron` in an existing web project
- add root `frontron.config.ts`
- use `app:dev` and `app:build`
- grow into `frontron/` only when app-layer code gets larger

`create-frontron` generates that same official shape.
:::
