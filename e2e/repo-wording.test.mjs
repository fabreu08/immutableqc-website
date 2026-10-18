// repo-wording.test.mjs · the repository files GitHub shows, read as marketing (docs/agent-discovery.md, A8): README.md,
// AGENTS.md, the Agent Skill (skills/), server.json, the MCPB manifest (agent/mcpb/manifest.json) and agent/README.md.
// They are never published on immutableqc.com (the deploy allowlist takes no .md and none of these paths), but the repo
// is public, and registries, skill installers and lists show them. So they follow the site's rules where they apply,
// from the one copy of those rules (site/tools/wording.mjs) and the shipped-file list (e2e/shipped-wording.test.mjs):
//   - no instrument, LIMS or lab-automation vendor by name, and no MCP client or AI vendor by name until the founder's
//     decision D4 (client-specific setup lines);
//   - the shipped-file rule, read whole (no chain, registry, smart contract, token, wallet, stake, mint, NFT, chain or
//     network name), with one allowance: the phrase "MCP Registry", the name of the directory the server will be listed
//     in (still upcoming, so a sentence that names it says so);
//   - no email address (contact goes through joseqc.com), US spelling;
//   - present tense only for what works: v1's rules (site/build.mjs 7g), read as sentences.
// site/build.mjs section 7i checks that the facts these files repeat agree with the agent's sources.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../site/tools/deploy.mjs'
import { SHIPPED_RAW as RAW, VENDORS, CLIENTS, EMAIL, US_SPELL, v1Problems, mdSentences, sentencesOf } from '../site/tools/wording.mjs'

const SKILLS = join(ROOT, 'skills')
export const REPO_FILES = ['README.md', 'AGENTS.md', 'server.json', 'agent/mcpb/manifest.json', 'agent/README.md',
  ...(existsSync(SKILLS) ? readdirSync(SKILLS, { recursive: true }).map((f) => `skills/${String(f).split('\\').join('/')}`).filter((f) => statSync(join(ROOT, f)).isFile()) : [])]

// the text of a JSON file as its string values, one per line (keys are names, not wording)
const jsonText = (src) => { const out = []; const walk = (v) => { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk) }; walk(JSON.parse(src)); return out.join('\n') }

export function repoProblems(f, src) {
  const out = []
  const t = f.endsWith('.json') ? jsonText(src) : src
  const plain = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`/g, '')
  const say = (what, m) => out.push(`${f}: ${what} (${m})`)
  let m
  if ((m = plain.match(VENDORS))) say('names a vendor', m[0])
  if ((m = plain.match(CLIENTS))) say('names an MCP client or AI vendor (decision D4)', m[0])
  for (const [re, what] of RAW) if ((m = plain.replace(/\bMCP Registry\b/g, 'MCP listing').match(re))) say(`names ${what}`, m[0])
  if ((m = plain.match(EMAIL))) say('has an email address', m[0])
  if ((m = plain.match(US_SPELL))) say('not US spelling', m[0])
  for (const p of v1Problems(f.endsWith('.md') ? mdSentences(t) : sentencesOf(plain))) say(p.rule, p.sentence.slice(0, 140))
  return out
}

test('repository files: no vendor or client name, no chain, registry or token words (but "MCP Registry"), no email, US spelling, present tense only for what works', () => {
  for (const need of ['README.md', 'AGENTS.md', 'server.json', 'agent/mcpb/manifest.json', 'agent/README.md', 'skills/immutableqc-lab-records/SKILL.md']) assert.ok(REPO_FILES.includes(need) && existsSync(join(ROOT, need)), `${need} exists`)
  const found = REPO_FILES.flatMap((f) => repoProblems(f, readFileSync(join(ROOT, f), 'utf8')))
  assert.deepEqual(found, [], `wording in ${found.length} place(s) of the repository files:\n  ${found.join('\n  ')}`)
})

test('repo-wording lint: catches what it is for, and passes the wording that stays', () => {
  const mustFail = [
    ['README.md', 'Install it with npm install immutableqc.'],
    ['README.md', 'Works with any CDS, for example Empower.'],
    ['README.md', 'Add it to Claude Desktop in one click.'],
    ['README.md', 'Listed in the registry.'],
    ['README.md', 'Write to us at someone@example.com.'],
    ['README.md', 'A Windows installer sets it up as a service.'],
    ['README.md', 'Per-person signatures identify\nwho changed a file.'],
    ['AGENTS.md', 'Each step is a token.'],
    ['server.json', '{"description": "Mint an NFT for every record"}'],
    ['skills/x/SKILL.md', '- The app shows the lineage of every value.'],
  ]
  for (const [f, src] of mustFail) assert.ok(repoProblems(f, src).length > 0, `caught: ${f}: ${src}`)
  const mustPass = [
    ['README.md', 'Upcoming: an npm package; a Windows installer and service; per-person keys and\nsignatures; Merkle batches.'],
    ['README.md', '| `server.json` | A draft of the MCP Registry entry: the listing is upcoming. | no |'],
    ['README.md', 'Contact goes through https://joseqc.com.'],
    ['README.md', '```\nnode iqc.mjs mcp --root /lab/agent-workspace --search /lab\n```'],
    ['server.json', '{"name": "com.immutableqc/laboratory-instrument-provenance", "description": "Checks lab inputs against sealed instrument files; records and traces AI agent steps, locally."}'],
  ]
  for (const [f, src] of mustPass) assert.deepEqual(repoProblems(f, src), [], `passes: ${f}: ${src}`)
})
