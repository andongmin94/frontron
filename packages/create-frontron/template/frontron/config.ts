import { defineConfig } from 'frontron'

import bridge from './bridge'
import hooks from './hooks'
import menu from './menu'
import tray from './tray'
import windows from './windows'

export default defineConfig({
  app: {
    name: '__FRONTRON_APP_NAME__',
    id: '__FRONTRON_APP_ID__',
    icon: './public/icon.ico',
  },
  web: {
    dev: {
      command: 'npm run web:dev',
      url: 'http://localhost:3000',
    },
    build: {
      command: 'npm run web:build',
      outDir: 'dist',
    },
  },
  windows,
  bridge,
  menu,
  tray,
  hooks,
  rust: {
    enabled: false,
    bridge: {
      file: {
        hasTxtExtension: {
          symbol: 'frontron_file_has_txt_extension',
          args: ['string'] as const,
          returns: 'bool' as const,
        },
      },
      system: {
        cpuCount: {
          symbol: 'frontron_system_cpu_count',
          returns: 'int' as const,
        },
      },
      health: {
        isReady: {
          symbol: 'frontron_native_is_ready',
          returns: 'bool' as const,
        },
      },
      math: {
        add: {
          symbol: 'frontron_native_add',
          args: ['int', 'int'] as const,
          returns: 'int' as const,
        },
        average: {
          symbol: 'frontron_native_average',
          args: ['double', 'double'] as const,
          returns: 'double' as const,
        },
      },
    },
  },
})
