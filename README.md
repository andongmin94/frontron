<div align=center>

<a href="https://frontron.vercel.app">
<img src="/docs/public/frontron.svg" alt="logo" height=200px>
</a>

</div>

# Frontron <a href="https://npmjs.com/package/frontron"><img src="https://img.shields.io/npm/v/frontron" alt="npm package"></a>

> Simplified Desktop App Building with Electron

Frontron is a powerful GUI library that streamlines the process of building desktop applications using Electron. It provides a suite of tools and features designed to make development faster and easier.

- 💡 Supporting React and Next.js
- ⚡️ Using popular CSS frameworks like Tailwind and Shadcn
- 📦 Many common components

## Installation

To get started with Frontron, you need to install it via npm:

```bash
npm install frontron
```

## Starting Project with template

Usage
Here's a simple example to get you started with Frontron:

### 1. Create a new Frontron project
You can create a new Frontron project using create-frontron. This tool allows you to scaffold a new project with various templates.

Compatibility Note:
Frontron requires Node.js version 20+. However, some templates require a higher Node.js version to work, please upgrade if your package manager warns about it.

With NPM:
```bash
$ npm create frontron@latest
```

With Yarn:
```bash
$ yarn create frontron
```

With PNPM:
```bash
$ pnpm create frontron
```

With Bun:
```bash
$ bun create frontron
```
Then follow the prompts!

You can also directly specify the project name and the template you want to use via additional command line options. For example, to scaffold a frontron project with React templates, run:

```bash
# npm 20+, extra double-dash is needed:
npm create frontron@latest my-react-app -- --template react

# yarn
yarn create frontron my-react-app --template react

# pnpm
pnpm create frontron my-react-app --template react

# Bun
bun create frontron my-react-app --template react
```

Currently Supported Template Presets

- `react`
- `react-ts`
- `react-swc`
- `react-swc-ts`
- `next-page`
- `next-page-ts`
- `next-app`
- `next-app-ts`

You can use . for the project name to scaffold in the current directory.

### 2. Start the development server

```bash
npm run app
```
This command will start the development server with hot module replacement, making it easy to see your changes in real-time.

### 3. Build your application for production

```bash
npm run build
```

This command will bundle your application using Rollup and produce optimized static assets for production.

Documentation
For more detailed information, please refer to the official Frontron documentation.

Contributing
We welcome contributions to Frontron! If you have any ideas, suggestions, or issues, please feel free to open an issue or a pull request on GitHub.

License
Frontron is licensed under the MIT License. See the LICENSE file for more details.

With Frontron, building desktop applications with Electron has never been easier. Get started today and simplify your development workflow!
