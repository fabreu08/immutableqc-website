#!/usr/bin/env node
// iqc, the Immutable QC agent. `node agent/bin/iqc.mjs help` (or the one-file download: node iqc.mjs help).
import { run } from '../src/cli.mjs'

process.exitCode = await run(process.argv.slice(2))
