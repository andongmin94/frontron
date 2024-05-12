# create-frontron <a href="https://npmjs.com/package/create-frontron"><img src="https://img.shields.io/npm/v/create-frontron" alt="npm package"></a>

> **Compatibility Note:**
> Frontron requires [Node.js](https://nodejs.org/en/) version 20+. However, some templates require a higher Node.js version to work, please upgrade if your package manager warns about it.

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

You can also directly specify the project name and the template you want to use via additional command line options. For example, to scaffold a `frontron` project with React templates, run:

```bash
# npm 7+, extra double-dash is needed:
npm create frontron@latest my-react-app -- --template react

# yarn
yarn create frontron my-react-app --template react

# pnpm
pnpm create frontron my-react-app --template react

# Bun
bun create frontron my-react-app --template react
```

Currently supported template presets include:

- `react`
- `react-ts`
- `react-swc`
- `react-swc-ts`
- `next-page`
- `next-page-ts`
- `next-app`
- `next-app-ts`

You can use . for the project name to scaffold in the current directory.