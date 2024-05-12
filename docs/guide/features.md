# Features

At the very basic level, developing using Frontron is not that different from using a static file server. However, Frontron provides many enhancements over native ESM imports to support various features that are typically seen in bundler-based setups.

## NPM Dependency Resolving and Pre-Bundling

Native ES imports do not support bare module imports like the following:

```js
import { someMethod } from 'my-dep'
```

The above will throw an error in the browser. Frontron will detect such bare module imports in all served source files and perform the following:

1. Pre-bundle them to improve page loading speed and convert CommonJS / UMD modules to ESM. The pre-bundling step is performed with [esbuild](http://esbuild.github.io/) and makes Frontron's cold start time significantly faster than any JavaScript-based bundler.

2. Rewrite the imports to valid URLs like `/node_modules/.vite/deps/my-dep.js?v=f3sf2ebd` so that the browser can import them properly.

## TypeScript

Frontron supports importing `.ts` files out of the box.

## JSX

`.jsx` and `.tsx` files are also supported out of the box. JSX transpilation is also handled via [esbuild](https://esbuild.github.io).

If using JSX without React or Vue, custom `jsxFactory` and `jsxFragment` can be configured using the `esbuild` option. For example for Preact:

```js twoslash
// vite.config.js
import { defineConfig } from 'vite'

export default defineConfig({
  esbuild: {
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
  },
})
```

More details in [esbuild docs](https://esbuild.github.io/content-types/#jsx).

You can inject the JSX helpers using `jsxInject` (which is a Vite-only option) to avoid manual imports:

```js twoslash
// vite.config.js
import { defineConfig } from 'vite'

export default defineConfig({
  esbuild: {
    jsxInject: `import React from 'react'`,
  },
})
```

## CSS

Importing `.css` files will inject its content to the page via a `<style>` tag with HMR support.

### `@import` Inlining and Rebasing

Frontron is pre-configured to support CSS `@import` inlining via `postcss-import`. Frontron aliases are also respected for CSS `@import`. In addition, all CSS `url()` references, even if the imported files are in different directories, are always automatically rebased to ensure correctness.

`@import` aliases and URL rebasing are also supported for Sass and Less files (see [CSS Pre-processors](#css-pre-processors)).

### PostCSS

If the project contains valid PostCSS config (any format supported by [postcss-load-config](https://github.com/postcss/postcss-load-config), e.g. `postcss.config.js`), it will be automatically applied to all imported CSS.

Note that CSS minification will run after PostCSS and will use `build.cssTarget` option.

### CSS Modules

Any CSS file ending with `.module.css` is considered a [CSS modules file](https://github.com/css-modules/css-modules). Importing such a file will return the corresponding module object:

```css
/* example.module.css */
.red {
  color: red;
}
```

```js twoslash
import 'vite/client'
// ---cut---
import classes from './example.module.css'
document.getElementById('foo').className = classes.red
```

CSS modules behavior can be configured via the `css.modules` option.

If `css.modules.localsConvention` is set to enable camelCase locals (e.g. `localsConvention: 'camelCaseOnly'`), you can also use named imports:

```js twoslash
import 'vite/client'
// ---cut---
// .apply-color -> applyColor
import { applyColor } from './example.module.css'
document.getElementById('foo').className = applyColor
```

### CSS Pre-processors

Because Frontron targets modern browsers only, it is recommended to use native CSS variables with PostCSS plugins that implement CSSWG drafts (e.g. [postcss-nesting](https://github.com/csstools/postcss-plugins/tree/main/plugins/postcss-nesting)) and author plain, future-standards-compliant CSS.

That said, Frontron does provide built-in support for `.scss`, `.sass`, `.less`, `.styl` and `.stylus` files. There is no need to install Vite-specific plugins for them, but the corresponding pre-processor itself must be installed:

```bash
# .scss and .sass
npm add -D sass

# .less
npm add -D less

# .styl and .stylus
npm add -D stylus
```

If using Vue single file components, this also automatically enables `<style lang="sass">` et al.

Frontron improves `@import` resolving for Sass and Less so that Frontron aliases are also respected. In addition, relative `url()` references inside imported Sass/Less files that are in different directories from the root file are also automatically rebased to ensure correctness.

`@import` alias and url rebasing are not supported for Stylus due to its API constraints.

You can also use CSS modules combined with pre-processors by prepending `.module` to the file extension, for example `style.module.scss`.

## Static Assets

Importing a static asset will return the resolved public URL when it is served:

```js twoslash
import 'vite/client'
// ---cut---
import imgUrl from './img.png'
document.getElementById('hero-img').src = imgUrl
```

Special queries can modify how assets are loaded:

```js twoslash
import 'vite/client'
```

```js twoslash
import 'vite/client'
// ---cut---
// Load assets as strings
import assetAsString from './shader.glsl?raw'
```

```js twoslash
import 'vite/client'
// ---cut---
// Load Web Workers
import Worker from './worker.js?worker'
```

```js twoslash
import 'vite/client'
// ---cut---
// Web Workers inlined as base64 strings at build time
import InlineWorker from './worker.js?worker&inline'
```

More details in Static Asset Handling.

## JSON

JSON files can be directly imported - named imports are also supported:

```js twoslash
import 'vite/client'
// ---cut---
// import the entire object
import json from './example.json'
// import a root field as named exports - helps with tree-shaking!
import { field } from './example.json'
```

## Glob Import

Frontron supports importing multiple modules from the file system via the special `import.meta.glob` function:

```js twoslash
import 'vite/client'
// ---cut---
const modules = import.meta.glob('./dir/*.js')
```

The above will be transformed into the following:

```js
// code produced by vite
const modules = {
  './dir/foo.js': () => import('./dir/foo.js'),
  './dir/bar.js': () => import('./dir/bar.js'),
}
```

You can then iterate over the keys of the `modules` object to access the corresponding modules:

```js
for (const path in modules) {
  modules[path]().then((mod) => {
    console.log(path, mod)
  })
}
```

Matched files are by default lazy-loaded via dynamic import and will be split into separate chunks during build. If you'd rather import all the modules directly (e.g. relying on side-effects in these modules to be applied first), you can pass `{ eager: true }` as the second argument:

```js twoslash
import 'vite/client'
// ---cut---
const modules = import.meta.glob('./dir/*.js', { eager: true })
```

The above will be transformed into the following:

```js
// code produced by vite
import * as __glob__0_0 from './dir/foo.js'
import * as __glob__0_1 from './dir/bar.js'
const modules = {
  './dir/foo.js': __glob__0_0,
  './dir/bar.js': __glob__0_1,
}
```

### Multiple Patterns

The first argument can be an array of globs, for example

```js twoslash
import 'vite/client'
// ---cut---
const modules = import.meta.glob(['./dir/*.js', './another/*.js'])
```

### Negative Patterns

Negative glob patterns are also supported (prefixed with `!`). To ignore some files from the result, you can add exclude glob patterns to the first argument:

```js twoslash
import 'vite/client'
// ---cut---
const modules = import.meta.glob(['./dir/*.js', '!**/bar.js'])
```

```js
// code produced by vite
const modules = {
  './dir/foo.js': () => import('./dir/foo.js'),
}
```

#### Named Imports

It's possible to only import parts of the modules with the `import` options.

```ts twoslash
import 'vite/client'
// ---cut---
const modules = import.meta.glob('./dir/*.js', { import: 'setup' })
```

```ts
// code produced by vite
const modules = {
  './dir/foo.js': () => import('./dir/foo.js').then((m) => m.setup),
  './dir/bar.js': () => import('./dir/bar.js').then((m) => m.setup),
}
```

When combined with `eager` it's even possible to have tree-shaking enabled for those modules.

```ts twoslash
import 'vite/client'
// ---cut---
const modules = import.meta.glob('./dir/*.js', {
  import: 'setup',
  eager: true,
})
```

```ts
// code produced by vite:
import { setup as __glob__0_0 } from './dir/foo.js'
import { setup as __glob__0_1 } from './dir/bar.js'
const modules = {
  './dir/foo.js': __glob__0_0,
  './dir/bar.js': __glob__0_1,
}
```

Set `import` to `default` to import the default export.

```ts twoslash
import 'vite/client'
// ---cut---
const modules = import.meta.glob('./dir/*.js', {
  import: 'default',
  eager: true,
})
```

```ts
// code produced by vite:
import __glob__0_0 from './dir/foo.js'
import __glob__0_1 from './dir/bar.js'
const modules = {
  './dir/foo.js': __glob__0_0,
  './dir/bar.js': __glob__0_1,
}
```

#### Custom Queries

You can also use the `query` option to provide queries to imports, for example, to import assets [as a string](https://vitejs.dev/guide/assets.html#importing-asset-as-string) or [as a url](https://vitejs.dev/guide/assets.html#importing-asset-as-url):

```ts twoslash
import 'vite/client'
// ---cut---
const moduleStrings = import.meta.glob('./dir/*.svg', {
  query: '?raw',
  import: 'default',
})
const moduleUrls = import.meta.glob('./dir/*.svg', {
  query: '?url',
  import: 'default',
})
```

```ts
// code produced by vite:
const moduleStrings = {
  './dir/foo.svg': () => import('./dir/foo.js?raw').then((m) => m['default']),
  './dir/bar.svg': () => import('./dir/bar.js?raw').then((m) => m['default']),
}
const moduleUrls = {
  './dir/foo.svg': () => import('./dir/foo.js?url').then((m) => m['default']),
  './dir/bar.svg': () => import('./dir/bar.js?url').then((m) => m['default']),
}
```

You can also provide custom queries for other plugins to consume:

```ts twoslash
import 'vite/client'
// ---cut---
const modules = import.meta.glob('./dir/*.js', {
  query: { foo: 'bar', bar: true },
})
```

### Glob Import Caveats

Note that:

- This is a Vite-only feature and is not a web or ES standard.
- The glob patterns are treated like import specifiers: they must be either relative (start with `./`) or absolute (start with `/`, resolved relative to project root) or an alias path (see `resolve.alias` option).
- The glob matching is done via [`fast-glob`](https://github.com/mrmlnc/fast-glob) - check out its documentation for [supported glob patterns](https://github.com/mrmlnc/fast-glob#pattern-syntax).
- You should also be aware that all the arguments in the `import.meta.glob` must be **passed as literals**. You can NOT use variables or expressions in them.

## Dynamic Import

Similar to [glob import](#glob-import), Frontron also supports dynamic import with variables.

```ts
const module = await import(`./dir/${file}.js`)
```

Note that variables only represent file names one level deep. If `file` is `'foo/bar'`, the import would fail. For more advanced usage, you can use the [glob import](#glob-import) feature.

## WebAssembly

Pre-compiled `.wasm` files can be imported with `?init`.
The default export will be an initialization function that returns a Promise of the [`WebAssembly.Instance`](https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/Instance):

```js twoslash
import 'vite/client'
// ---cut---
import init from './example.wasm?init'

init().then((instance) => {
  instance.exports.test()
})
```

The init function can also take an importObject which is passed along to [`WebAssembly.instantiate`](https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/instantiate) as its second argument:

```js twoslash
import 'vite/client'
import init from './example.wasm?init'
// ---cut---
init({
  imports: {
    someFunc: () => {
      /* ... */
    },
  },
}).then(() => {
  /* ... */
})
```

In the production build, `.wasm` files smaller than `assetInlineLimit` will be inlined as base64 strings. Otherwise, they will be treated as a static asset and fetched on-demand.

::: tip NOTE
[ES Module Integration Proposal for WebAssembly](https://github.com/WebAssembly/esm-integration) is not currently supported.
Use [`vite-plugin-wasm`](https://github.com/Menci/vite-plugin-wasm) or other community plugins to handle this.
:::

### Accessing the WebAssembly Module

If you need access to the `Module` object, e.g. to instantiate it multiple times, use an explicit URL import to resolve the asset, and then perform the instantiation:

```js twoslash
import 'vite/client'
// ---cut---
import wasmUrl from 'foo.wasm?url'

const main = async () => {
  const responsePromise = fetch(wasmUrl)
  const { module, instance } =
    await WebAssembly.instantiateStreaming(responsePromise)
  /* ... */
}

main()
```

### Fetching the module in Node.js

In SSR, the `fetch()` happening as part of the `?init` import, may fail with `TypeError: Invalid URL`.
See the issue [Support wasm in SSR](https://github.com/vitejs/vite/issues/8882).

Here is an alternative, assuming the project base is the current directory:

```js twoslash
import 'vite/client'
// ---cut---
import wasmUrl from 'foo.wasm?url'
import { readFile } from 'node:fs/promises'

const main = async () => {
  const resolvedUrl = (await import('./test/boot.test.wasm?url')).default
  const buffer = await readFile('.' + resolvedUrl)
  const { instance } = await WebAssembly.instantiate(buffer, {
    /* ... */
  })
  /* ... */
}

main()
```

## Web Workers

### Import with Constructors

A web worker script can be imported using [`new Worker()`](https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker) and [`new SharedWorker()`](https://developer.mozilla.org/en-US/docs/Web/API/SharedWorker/SharedWorker). Compared to the worker suffixes, this syntax leans closer to the standards and is the **recommended** way to create workers.

```ts
const worker = new Worker(new URL('./worker.js', import.meta.url))
```

The worker constructor also accepts options, which can be used to create "module" workers:

```ts
const worker = new Worker(new URL('./worker.js', import.meta.url), {
  type: 'module',
})
```

The worker detection will only work if the `new URL()` constructor is used directly inside the `new Worker()` declaration. Additionally, all options parameters must be static values (i.e. string literals).

### Import with Query Suffixes

A web worker script can be directly imported by appending `?worker` or `?sharedworker` to the import request. The default export will be a custom worker constructor:

```js twoslash
import 'vite/client'
// ---cut---
import MyWorker from './worker?worker'

const worker = new MyWorker()
```

The worker script can also use ESM `import` statements instead of `importScripts()`. **Note**: During development this relies on [browser native support](https://caniuse.com/?search=module%20worker), but for the production build it is compiled away.

By default, the worker script will be emitted as a separate chunk in the production build. If you wish to inline the worker as base64 strings, add the `inline` query:

```js twoslash
import 'vite/client'
// ---cut---
import MyWorker from './worker?worker&inline'
```

If you wish to retrieve the worker as a URL, add the `url` query:

```js twoslash
import 'vite/client'
// ---cut---
import MyWorker from './worker?worker&url'
```

See Worker Options for details on configuring the bundling of all workers.

## Content Security Policy (CSP)

To deploy CSP, certain directives or configs must be set due to Vite's internals.

### [`'nonce-{RANDOM}'`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/Sources#nonce-base64-value)

When `html.cspNonce` is set, Frontron adds a nonce attribute with the specified value to any `<script>` and `<style>` tags, as well as `<link>` tags for stylesheets and module preloading. Additionally, when this option is set, Frontron will inject a meta tag (`<meta property="csp-nonce" nonce="PLACEHOLDER" />`).

The nonce value of a meta tag with `property="csp-nonce"` will be used by Frontron whenever necessary during both dev and after build.

:::warning
Ensure that you replace the placeholder with a unique value for each request. This is important to prevent bypassing a resource's policy, which can otherwise be easily done.
:::

### [`data:`](<https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/Sources#scheme-source:~:text=schemes%20(not%20recommended).-,data%3A,-Allows%20data%3A>)

By default, during build, Frontron inlines small assets as data URIs. Allowing `data:` for related directives (e.g. [`img-src`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/img-src), [`font-src`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/font-src)), or, disabling it by setting `build.assetsInlineLimit: 0` is necessary.

:::warning
Do not allow `data:` for [`script-src`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/script-src). It will allow injection of arbitrary scripts.
:::

## Build Optimizations

> Features listed below are automatically applied as part of the build process and there is no need for explicit configuration unless you want to disable them.

### CSS Code Splitting

Frontron automatically extracts the CSS used by modules in an async chunk and generates a separate file for it. The CSS file is automatically loaded via a `<link>` tag when the associated async chunk is loaded, and the async chunk is guaranteed to only be evaluated after the CSS is loaded to avoid [FOUC](https://en.wikipedia.org/wiki/Flash_of_unstyled_content#:~:text=A%20flash%20of%20unstyled%20content,before%20all%20information%20is%20retrieved.).

If you'd rather have all the CSS extracted into a single file, you can disable CSS code splitting by setting `build.cssCodeSplit` to `false`.

### Preload Directives Generation

Frontron automatically generates `<link rel="modulepreload">` directives for entry chunks and their direct imports in the built HTML.

### Async Chunk Loading Optimization

In real world applications, Rollup often generates "common" chunks - code that is shared between two or more other chunks. Combined with dynamic imports, it is quite common to have the following scenario:

In the non-optimized scenarios, when async chunk `A` is imported, the browser will have to request and parse `A` before it can figure out that it also needs the common chunk `C`. This results in an extra network roundtrip:

```
Entry ---> A ---> C
```

Frontron automatically rewrites code-split dynamic import calls with a preload step so that when `A` is requested, `C` is fetched **in parallel**:

```
Entry ---> (A + C)
```

It is possible for `C` to have further imports, which will result in even more roundtrips in the un-optimized scenario. Frontron's optimization will trace all the direct imports to completely eliminate the roundtrips regardless of import depth.