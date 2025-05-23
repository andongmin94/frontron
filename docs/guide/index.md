# Getting Started

## Overview

Frontron is GUI Library that supports desktop app development for web developers.

## Browser Support

Frontron supports Chromium V8 engine and Electron browsers.

You can use this for your web project by changing some configurations in frontron.


## Viewing Source Code

You can view Frontron templates source code in GitHub repository.

The supported template presets are:

|             JavaScript              |                TypeScript                 |
| :---------------------------------: | :---------------------------------------: |
|  [react](https://github.com/andongmin94/frontron/tree/main/packages/create-frontron/template-react)    |  [react-ts](https://github.com/andongmin94/frontron/tree/main/packages/create-frontron/template-react-ts)    |
|  [next](https://github.com/andongmin94/frontron/tree/main/packages/create-frontron/template-next)|  [next-ts](https://github.com/andongmin94/frontron/tree/main/packages/create-frontron/template-next-ts)|


## Scaffolding Your First Frontron Project

::: tip Compatibility Note
Frontron requires [Node.js](https://nodejs.org/en/) version 20+.
:::

::: code-group

```bash [NPM]
npm create frontron

npx create-frontron
```

```bash [Yarn]
$ yarn create frontron
```

```bash [PNPM]
$ pnpm create frontron
```

```bash [Bun]
$ bun create frontron
```

:::

Then follow the prompts!

You can also directly specify the project name and the template you want to use via additional command line options. For example, to scaffold a frontron + React project, run:

```bash
# npm 20+
npm create frontron@latest my-react-app -- --template react

# yarn
yarn create frontron my-react-app --template react

# pnpm
pnpm create frontron my-react-app --template react

# bun
bun create frontron my-react-app --template react
```

See [create-frontron](https://github.com/andongmin94/frontron/tree/main/packages/create-frontron) for more details on each supported template: `react`, `react-ts`, `react-swc`, `react-swc-ts`, `next`, `next-ts`.

## How to Update Icons

1. **Taskbar Icon**: This icon is displayed on the taskbar when your application is running.
2. **System Tray Icon**: This icon appears in the system tray area, usually at the bottom-right corner of the screen (on Windows) or the top-right corner (on macOS).
3. **Desktop Icon**: This is the icon displayed on the desktop shortcut of your application.
4. **Favicon**: This icon appears in the browser tab when your application is accessed as a web app.
5. **Logo**: This is the general logo used throughout your application.

You can find the `icon.png` file in the `public` directory. Replace this file with your desired icon to update all the mentioned icons simultaneously.

```
/public
└─icon.png
```

To update these icons, simply replace the `icon.png` file in the `public` directory with your custom icon. Ensure that the new icon follows the recommended size and format (usually 512x512 pixels, PNG format) for best results.

After replacing the icon, you don't need to restart your application or clear the browser cache to see the changes take effect.

## Options for `Install frontron`

If you want to use Frontron like `install frontron` in your current project, `install` command needs some configuration in your package and directory.
