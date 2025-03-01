const menu = [
  {
    label: 'Window',
    submenu: [
      {
        label: 'Toggle Maximize',
        onClick: ({ window }) => window.toggleMaximize(),
      },
      {
        label: 'Open Frontron Docs',
        onClick: ({ shell }) =>
          shell.openExternal({ url: 'https://frontron.andongmin.com' }),
      },
    ],
  },
]

export default menu
