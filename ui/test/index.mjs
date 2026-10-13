// Entry for `node --test ui/test`. Node 22 treats a directory argument as a module path and runs it, which resolves
// (package.json "main") to this file; this file then loads every *.test.mjs in the folder. When this file is run on
// its own (for example by a bare `node --test`, which also finds the *.test.mjs files itself), it does nothing, so no
// test runs twice.
import { readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
if (process.argv[1] && resolve(process.argv[1]) === here) {
  for (const f of readdirSync(here).filter((x) => x.endsWith('.test.mjs')).sort()) await import(pathToFileURL(join(here, f)).href)
}
