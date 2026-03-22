import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    'src/index',
    'src/client',
    'src/cli',
    'src/runtime/main',
    'src/runtime/preload',
  ],
  clean: true,
  declaration: true,
  rollup: {
    inlineDependencies: true,
    esbuild: {
      target: 'node22',
    },
  },
})
