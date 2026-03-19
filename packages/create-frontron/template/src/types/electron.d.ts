export {}

declare global {
  interface Window {
    electron?: {
      send: (channel: string, data?: unknown) => void
      invoke?: <T = unknown>(
        channel: string,
        ...args: unknown[]
      ) => Promise<T>
      on?: (
        channel: string,
        listener: (...args: unknown[]) => void,
      ) => () => void
    }
  }
}
