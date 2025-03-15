import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: ['src/index'],
  clean: true,
  rollup: {
    inlineDependencies: true,
    esbuild: {
      target: 'node22',
      minify: true,
    },
  },
  alias: {
    // We can use the non-transpiled entry because Node 22+ is required.
    prompts: 'prompts/lib/index.js',
  },
})
