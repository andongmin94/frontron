#!/usr/bin/env node

import { runCreateFrontron } from './dist/index.mjs'

void runCreateFrontron().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
