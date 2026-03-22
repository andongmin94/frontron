const bridge = {
  app: {
    getGreeting: () => 'Hello from frontron/bridge.',
    getSummary: () => ({
      mode: 'framework-first',
      layer: 'app',
    }),
  },
}

export default bridge
