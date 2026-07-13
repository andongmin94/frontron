import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: ['src/index'],
  clean: true,
  rollup: {
    esbuild: {
      target: 'node22',
      minify: true,
    },
  },
})
