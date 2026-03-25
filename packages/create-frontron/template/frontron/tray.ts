import type { FrontronDesktopContext, FrontronTrayConfig } from 'frontron'

const tray: FrontronTrayConfig = {
  icon: './public/icon.ico',
  tooltip: '__FRONTRON_APP_NAME__',
  items: [
    {
      label: 'Show Window',
      onClick: ({ window }: FrontronDesktopContext) => window.show(),
    },
    {
      label: 'Quit',
      onClick: ({ app }: FrontronDesktopContext) => app.quit(),
    },
  ],
}

export default tray
