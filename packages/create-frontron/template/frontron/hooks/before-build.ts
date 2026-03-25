import type { FrontronHookContext } from 'frontron'

const beforeBuild = ({ rootDir }: FrontronHookContext) => {
  console.info(`[Frontron hook] beforeBuild ${String(rootDir)}`)
}

export default beforeBuild
