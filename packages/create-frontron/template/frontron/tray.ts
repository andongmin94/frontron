const tray = {
  icon: './public/icon.ico',
  tooltip: '__FRONTRON_APP_NAME__',
  items: [
    {
      label: 'Show Window',
      onClick: ({ window }) => window.show(),
    },
    {
      label: 'Quit',
      onClick: ({ app }) => app.quit(),
    },
  ],
}

export default tray
