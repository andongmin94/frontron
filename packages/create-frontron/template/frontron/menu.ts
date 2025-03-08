import type { FrontronDesktopContext, FrontronMenuConfig } from 'frontron'

const menu: FrontronMenuConfig = [
  {
    label: 'Window',
    submenu: [
      {
        label: 'Toggle Maximize',
        onClick: ({ window }: FrontronDesktopContext) => window.toggleMaximize(),
      },
      {
        label: 'Open Frontron Docs',
        onClick: ({ shell }: FrontronDesktopContext) =>
          shell.openExternal({ url: 'https://frontron.andongmin.com' }),
      },
    ],
  },
]

export default menu
