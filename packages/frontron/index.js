#!/usr/bin/env node

import { runCli } from './dist/cli.mjs'

const exitCode = await runCli()
process.exitCode = exitCode
