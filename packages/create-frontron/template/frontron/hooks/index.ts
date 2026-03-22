import afterPack from './after-pack'
import beforeBuild from './before-build'
import beforeDev from './before-dev'

const hooks = {
  beforeDev,
  beforeBuild,
  afterPack,
}

export default hooks
