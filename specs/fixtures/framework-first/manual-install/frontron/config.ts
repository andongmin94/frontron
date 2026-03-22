import { defineConfig } from 'frontron'

import bridge from './bridge'
import windows from './windows'

export default defineConfig({
  app: {
    name: 'Example App',
    id: 'com.example.app',
  },
  web: {
    dev: {
      command: 'npm run web:dev',
      url: 'http://localhost:5173',
    },
    build: {
      command: 'npm run web:build',
      outDir: 'dist',
    },
  },
  windows,
  bridge,
})
