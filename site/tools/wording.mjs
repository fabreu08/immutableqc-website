// wording.mjs · the site's wording rules, shared by site/build.mjs (section 7: the document set, the hand-written pages
// and scripts, and since the agent-discovery work the files written for AI agents, section 7i) and by the repository
// wording test (e2e/repo-wording.test.mjs: README.md, AGENTS.md, the skill, server.json and the MCPB manifest, which are
// public on GitHub and read as marketing too). One copy of each rule, so the two cannot drift. Never published (site/).

// Banned everywhere: the document pages, the hand-written pages and every string literal in the shipped JavaScript.
export const BANNED = [/cannot be altered/i, /\bimmutab(le|ility)\b/i, /guarantee/i, /compliance[- ]ready/i, /\bcompliant\b/i, /\bproofs?\b/i,
  /unbreakable/i, /trustless/i, /revolutionar/i, /(?<!no )\bcustomers?\b(?! yet)/i, /\bpilots?\b/i, /\btrading\b/i, /\bprices?\b/i, /\bstak(e|es|ed|ing)\b/i,
  /\bwallets?\b/i, /\btokens?\b/i, /token sale/i, /\bIQC token/i, /\bNFTs?\b/i, /\bmint(s|ed|ing)?\b/i, /\bcrypto\b/i, /cryptocurrenc/i,
  /MetaMask/i, /\btFIL\b/i, /faucet/i, /\b(Waters|Empower|Agilent|OpenLAB|OpenLab|Shimadzu|Thermo|Chromeleon|PerkinElmer|Sciex|SCIEX|Bruker|MassLynx|LabSolutions|Alliance|LabWare|STARLIMS|Opentrons|Hamilton|Tecan|Beckman|Strateos|Emerald Cloud|Benchling|Chemspeed|Ginkgo|Synthace|Scitara|Sapio|Dotmatics|LabVantage|Transcriptic)\b/]
// the instrument, LIMS and lab-automation vendors in BANNED, alone (the repository files name no vendor either)
export const VENDORS = BANNED[BANNED.length - 1]
// Stricter on the marketing pages: no "crypto" inside any word (WebCrypto, cryptographic), no "compliance" at all.
export const BANNED_SITE = [/crypto/i, /\bcomplian(t|ce)\b/i]
// banned in the whole text of every file GitHub Pages publishes (e2e/shipped-wording.test.mjs, docs/patent-guardrails.md),
// and of the repository files GitHub shows (e2e/repo-wording.test.mjs, which allows the phrase "MCP Registry")
export const SHIPPED_RAW = [
  [/\bon[- ]?chain\b|\bchain ?ids?\b|\bdistributed ledgers?\b|\bblock (?:height|explorer)\b|\bgas fees?\b/i, 'a chain or distributed ledger'],
  [/\bregistr(?:y|ies)\b/i, 'a registry'],
  [/\bsmart[- ]contracts?\b/i, 'a smart contract'],
  [/\btokens?\b|\btokenis/i, 'a token'],
  [/\bwallets?\b/i, 'a wallet'],
  [/\bstak(?:e|es|ed|ing)\b/i, 'a stake'],
  [/\bmint(?:s|ed|ing)?\b/i, 'minting'],
  [/\bNFTs?\b/i, 'an NFT'],
  [/\b(?:ethereum|bitcoin|sepolia|metamask|basescan|filecoin|tFIL|testnets?|web3|dapps?)\b/i, 'a chain, network or wallet name'],
]
// MCP clients and AI vendors by name: the site and the llms files stay client-neutral ("any MCP client that starts local
// servers over standard input and output"); client-specific lines wait for the founder's decision D4
// (docs/agent-discovery.md, section 4). Case-sensitive: "cursor" is a word of the protocol, "Cursor" a product.
export const CLIENTS = /\b(?:Claude|Anthropic|OpenAI|ChatGPT|Codex|Copilot|Gemini|Cursor|Windsurf|Cline|Zed|VS ?Code|Visual Studio|JetBrains|LM Studio|Ollama|LangChain|LlamaIndex|Smithery|Glama|PulseMCP|Docker|Hugging ?Face|Microsoft|Google|Bing|Perplexity|Mistral|DeepSeek|Grok)\b/
export const EMAIL = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i
// US spelling (the list grew in Draft 7 with the new pages and scripts; every word it held before is still here)
export const US_SPELL = /\b(?:labell(?:ed|ing)|modell(?:ed|ing)|computeris(?:e|ed|ation)|organis(?:ation|e|ed|ing)|behaviour|colour|licence|analys(?:e|ed|ing)|normalis(?:e|ed|es|ing|ation)|serialis(?:e|ed|es|ing|ation)|initialis(?:e|ed|es|ing|ation)|recognis(?:e|ed|es|ing)|optimis(?:e|ed|es|ing|ation)|centre|artefacts?)\b/i
export const ENT = (t) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&shy;/g, '')
// a clause that is negated ("nothing … writes to a network", "no shared registry") is not a claim that something works
export const unneg = (s) => s.replace(/\b(?:nothing|never|not|no)\b[^,;:.]*/gi, '')
// nothing about the product is called broken or "not working"
export const NOT_WORKING = /\b(?:do|does) not work\b|\b(?:don|doesn)[’']t work\b|\bnot working\b|\bnot work(?:ing)? yet\b|\bnon-?functional\b|\bdead (?:button|link)s?\b|\bbroken in\b/i
// the words that say a thing is not built yet (section 7e's strict list)
export const NEW_OK_STRICT = /\bupcoming\b|\bwill\b|\bwould\b|\bonce\b|\bnot yet\b|\buntil\b|\bsimulated\b|\bthe plan\b/i
// What v1 does not do (docs/product-v1.md, section 1) carries the one label "Upcoming" in any copy (build.mjs 7g)
export const V1_FEAT = /\banchor(?:s|ed|ing)?\b|\bpublic (?:test )?networks?\b|\bblockchains?\b|\bon-?chain\b|\bregistr(?:y|ies)\b|\bMerkle\b|\bencrypted archives?\b|\bFilecoin\b|\bper-(?:person|analyst|user) signatures?\b|\bper-result records?\b|\bextract(?:s|ed|ing|ion of)? (?:the )?values\b|\blineage\b|\bseal(?:s|ed|ing)?(?: \w+)? at capture\b|\binside the (?:vendor|instrument)(?:’s|'s)? software\b|\bWindows (?:installer|service)\b|\binstallers?\b|\bnpm (?:package|install)\b|\bpost-quantum\b|\bquantum\b|\bML-DSA\b|\bSLH-DSA\b|\bML-KEM\b/i
// read with the negated clauses removed (unneg): "Nothing is uploaded" is not a claim; "…; it is anchored" is
export const V1_NOW = [
  /(?<!\b(?:will|would|could|should|might|may|to|not) be )\b(?:is|are|was|were|gets?|got) anchored\b/i,
  /(?<!\b(?:will|would|could|should|might|may|to) )\banchors (?:the|each|every|its|your|a) /i,
  /\b(?:is|are|was|were) (?:written|published|sent|uploaded|stored|copied) (?:on|to) (?:a |the |our |any )?(?:public )?(?:test )?(?:network|blockchain|registry|cloud|server)\b/i,
  /\b(?:is|are) (?:archived|stored|kept|uploaded|encrypted) (?:on|to|in) Filecoin\b|\bFilecoin (?:holds|stores|keeps)\b/i,
  /\b(?:signs|signed|seals|sealed) (?:\w+ ){0,3}with (?:ML-DSA|SLH-DSA|ML-KEM|a post-quantum)\b|\buses (?:ML-DSA|SLH-DSA|ML-KEM|Merkle|a Merkle|Filecoin)\b/i,
  /\b(?:computes|traces|tracks|shows|follows) (?:its |the |a |every )?lineage\b/i,
  /\bnpm (?:install|i) (?:-g )?\S/i,
]
export const NOT_V1 = (s) => !/\?$/.test(s) && V1_FEAT.test(unneg(s)) && !NEW_OK_STRICT.test(s)
export const NOW_V1 = (s) => V1_NOW.some((re) => re.test(unneg(s)))
export const LABEL_OLD_V1 = /\bon the roadmap\b|\bplanned\b|\bcoming soon\b/i
// the product name and domain are not banned words
export const scrub = (t) => t.replace(/Immutable QC/g, '').replace(/immutableqc/gi, '')
// plain text (a .txt or .md file, a JSON string) as sentences: a sentence ends at a line break or at . ! ?
export const sentencesOf = (t) => t.split(/\n+/).flatMap((l) => l.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)).map((x) => x.trim()).filter((x) => /[a-z]{2}/i.test(x))
// Markdown as sentences: a paragraph's wrapped lines join; a heading, a list item (with its indented continuation
// lines), a table row and each line of a code block stand alone; links keep their text, code marks go
export function mdSentences(md) {
  const blocks = []
  let fence = false, cur = null
  const flush = () => { if (cur !== null) blocks.push(cur); cur = null }
  for (const line of md.replace(/\r/g, '').split('\n')) {
    if (/^\s*```/.test(line)) { flush(); fence = !fence; continue }
    if (fence) { blocks.push(line); continue }
    if (!line.trim()) { flush(); continue }
    if (/^\s*(?:#{1,6} |\||[-*] |\d+\. |>)/.test(line)) { flush(); cur = line; continue }
    cur = cur === null ? line : `${cur} ${line.trim()}`
  }
  flush()
  return blocks.flatMap((b) => sentencesOf(b.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`/g, '')))
}
// every present-tense problem in a list of sentences (build.mjs's lintV1 without section 7f, which is about the
// document set's upcoming defenses): [{rule, sentence}]
export function v1Problems(sents) {
  const out = []
  for (const s of sents) {
    if (NOT_V1(s)) out.push({ rule: 'names something v1 does not do without saying upcoming, will/would, once, not yet, until or simulated', sentence: s })
    if (NOW_V1(s)) out.push({ rule: 'a present-tense claim that anchoring, an upload, post-quantum signatures, lineage or an npm package works today', sentence: s })
    if (NOT_WORKING.test(s)) out.push({ rule: 'something called "not working"', sentence: s })
    if (LABEL_OLD_V1.test(s)) out.push({ rule: 'one label for what is not built: "Upcoming"', sentence: s })
  }
  return out
}
