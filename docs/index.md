---
layout: home

title: Frontron
titleTemplate: Framework-First Desktop Apps

hero:
  name: Frontron
  text: Run an existing web app as a desktop app with a framework-first contract
  tagline: "Run `npx frontron init`, then run `app:dev` and `app:build`."
  image:
    src: /logo.svg
    alt: Frontron
  actions:
    - theme: brand
      text: Quick Start
      link: /guide/
    - theme: alt
      text: Existing Project Manual
      link: /guide/install-existing-project
    - theme: alt
      text: GitHub
      link: https://github.com/andongmin94/frontron

features:
  - title: Use in an Existing Project
    details: Add Frontron to a web app you already have, write a root config, and launch desktop mode.
    link: /guide/install-existing-project
    linkText: Open manual
  - title: Understand the Bridge Flow
    details: "Learn the simple mental model first: frontend UI calls `frontron/client`, and Frontron runs desktop-side code for you."
    link: /guide/understand-bridge-flow
    linkText: Open explanation
  - title: Start a New Project
    details: Generate the official starter, run the desktop app, and make the first visible change.
    link: /guide/create-project
    linkText: Open starter guide
  - title: Build and Package
    details: "Understand what `app:build` stages, where output files go, and how to debug failures."
    link: /guide/build-and-package
    linkText: Open build guide

---

## Start with the path that matches you

## If the bridge feels confusing

Start here first:

1. [Understand the Bridge Flow](/guide/understand-bridge-flow)
2. [Use the Desktop Bridge](/guide/use-bridge)

### I already have a web app

1. [Install into an Existing Project](/guide/install-existing-project)
2. [Understand the Bridge Flow](/guide/understand-bridge-flow)
3. [Run in Development](/guide/run-development)
4. [Use the Desktop Bridge](/guide/use-bridge)
5. [Build and Package](/guide/build-and-package)

### I want a new starter project

1. [Create a Project](/guide/create-project)
2. [Run in Development](/guide/run-development)
3. [Change App Name and Icon](/guide/customize-app)
4. [Understand the Generated Structure](/guide/understand-template)

## What Frontron owns

- config discovery and the `frontron` CLI
- Electron runtime and packaging flow
- the desktop bridge through `frontron/client`
- the optional Rust slot at `frontron/rust`

## Good first manuals

- [Quick Start](/guide/)
- [Install into an Existing Project](/guide/install-existing-project)
- [Understand the Bridge Flow](/guide/understand-bridge-flow)
- [Use the Desktop Bridge](/guide/use-bridge)
- [Troubleshooting](/guide/troubleshooting)
