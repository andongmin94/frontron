import type { FrontronHookContext } from 'frontron'

const afterPack = ({ outputDir }: FrontronHookContext) => {
  if (!outputDir) {
    return
  }

  console.info(`[Frontron hook] afterPack ${String(outputDir)}`)
}

export default afterPack
