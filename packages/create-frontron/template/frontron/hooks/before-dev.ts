import type { FrontronHookContext } from 'frontron'

const beforeDev = ({ rootDir }: FrontronHookContext) => {
  console.info(`[Frontron hook] beforeDev ${String(rootDir)}`)
}

export default beforeDev
