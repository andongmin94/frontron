---
layout: home

title: Frontron
titleTemplate: CLI-Assisted Electron Starters

hero:
  name: Frontron
  text: Start a desktop app from a web-friendly starter, then run it through the Frontron CLI
  tagline: "Start with `npm create frontron@latest`, then run `app:dev` and `app:build`."
  image:
    src: /logo.svg
    alt: Frontron
  actions:
    - theme: brand
      text: Quick Start
      link: /guide/
    - theme: alt
      text: Create a Project
      link: /guide/create-project
    - theme: alt
      text: GitHub
      link: https://github.com/andongmin94/frontron

features:
  - title: Start with a Starter
    details: Generate the official Frontron starter and run the desktop app immediately.
    link: /guide/create-project
    linkText: Open starter guide
  - title: Understand the Bridge Flow
    details: Frontend UI still talks through `frontron/client`, while the support package runs the desktop side for you.
    link: /guide/understand-bridge-flow
    linkText: Open explanation
  - title: Manual Setup Still Works
    details: Compatible existing web projects can still install `frontron` directly and use the same config/CLI flow.
    link: /guide/install-existing-project
    linkText: Open manual
  - title: Build and Package
    details: Learn what `app:build` stages, where output files go, and how to debug failures.
    link: /guide/build-and-package
    linkText: Open build guide

---

## Start with the path that matches you

### I want the quickest start

1. [Create a Project](/guide/create-project)
2. [Run in Development](/guide/run-development)
3. [Change App Name and Icon](/guide/customize-app)
4. [Understand the Generated Structure](/guide/understand-template)

### I already have a compatible web app

1. [Install into an Existing Project](/guide/install-existing-project)
2. [Run in Development](/guide/run-development)
3. [Use the Desktop Bridge](/guide/use-bridge)
4. [Build and Package](/guide/build-and-package)

### If the bridge feels abstract

1. [Understand the Bridge Flow](/guide/understand-bridge-flow)
2. [Use the Desktop Bridge](/guide/use-bridge)

## What Frontron provides

- `create-frontron` for starter generation
- the `frontron` CLI and runtime/build support
- the desktop bridge through `frontron/client`
- the optional Rust slot at `frontron/rust`

## Good first manuals

- [Quick Start](/guide/)
- [Create a Project](/guide/create-project)
- [Run in Development](/guide/run-development)
- [Understand the Bridge Flow](/guide/understand-bridge-flow)
- [Troubleshooting](/guide/troubleshooting)
