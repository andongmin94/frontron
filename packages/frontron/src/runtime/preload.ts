import { contextBridge, ipcRenderer } from 'electron'

const invoke = (command: string, ...args: unknown[]) =>
  ipcRenderer.invoke('frontron:invoke', command, ...args)

const runtime = new Proxy({} as Record<string, Record<string, (...args: unknown[]) => unknown>>, {
  get(_target, namespace) {
    return new Proxy({} as Record<string, (...args: unknown[]) => unknown>, {
      get(_namespaceTarget, method) {
        if (String(namespace) === 'window' && String(method) === 'onMaximizedChanged') {
          return (listener: (isMaximized: boolean) => void) => {
            const wrapped = (_event: unknown, value: unknown) => listener(Boolean(value))
            ipcRenderer.on('frontron:event:window.maximizedChanged', wrapped)

            return () => {
              ipcRenderer.removeListener('frontron:event:window.maximizedChanged', wrapped)
            }
          }
        }

        return (...args: unknown[]) => invoke(`${String(namespace)}.${String(method)}`, ...args)
      },
    })
  },
})

contextBridge.exposeInMainWorld('__FRONTRON_BRIDGE__', runtime)
