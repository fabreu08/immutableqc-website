// The signing key. First use creates an ECDSA P-256 key and saves its private part as a JWK file in
// ~/.immutableqc/keys/<keyId>.jwk (the folder 0700, the file 0600 where the system has modes; created with exclusive
// create, so an existing file is never overwritten). Later runs load the key named by the ledger header's keyId, or
// the file given with --key, and refuse when it is missing or is not the ledger's key.
import { homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { mkdirSync, chmodSync, openSync, writeSync, fsyncSync, closeSync, readFileSync, statSync } from 'node:fs'
import { generateKeyPair, publicKeyHex, keyIdOf, exportPrivateJwk, importPrivateJwk, publicKeyHexOfJwk, keyMatches } from '../../core/immutableqc.mjs'
import { UserError } from './util.mjs'

export const keysDir = () => join(homedir(), '.immutableqc', 'keys')
export const keyFileOf = (keyId) => join(keysDir(), `${keyId}.jwk`)

export async function createKey() {
  const pair = await generateKeyPair({ extractable: true })
  const pub = await publicKeyHex(pair.publicKey)
  const keyId = keyIdOf(pub)
  const { kty, crv, x, y, d } = await exportPrivateJwk(pair.privateKey)
  const dir = keysDir()
  const file = join(dir, `${keyId}.jwk`)
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    for (const f of [dirname(dir), dir]) try { chmodSync(f, 0o700) } catch { /* a system without modes */ }
    const fd = openSync(file, 'wx', 0o600)
    try {
      writeSync(fd, JSON.stringify({ kty, crv, x, y, d, kid: keyId }, null, 2) + '\n')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    try { chmodSync(file, 0o600) } catch { /* a system without modes */ }
  } catch (e) {
    throw new UserError(`Could not save the new signing key to ${file} (${e.code || e.message}). Nothing was written to the ledger.`)
  }
  return { privateKey: await importPrivateJwk({ kty, crv, x, y, d }), publicKeyHex: pub, keyId, file, created: true }
}

// Loads the key for a ledger whose header is `header` (or, for a new ledger, the --key file alone).
export async function loadKey({ header = null, keyOpt = null, out = null } = {}) {
  const file = keyOpt ? resolve(keyOpt) : keyFileOf(header.keyId)
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT' && !keyOpt) {
      throw new UserError(`This ledger's signing key (key id ${header.keyId}) is not on this computer: there is no ${header.keyId}.jwk in ${keysDir()}. ` +
        'Copy the key file there from the computer that started this ledger, or give it with --key <file>. Nothing was written. (An audit needs no key: iqc audit.)')
    }
    throw new UserError(e.code === 'ENOENT' ? `No key file at ${file}. Nothing was written.` : `Cannot read the key file ${file} (${e.code || e.message}). Nothing was written.`)
  }
  let jwk, pub
  try {
    jwk = JSON.parse(text)
    pub = publicKeyHexOfJwk(jwk)
  } catch {
    throw new UserError(`${file} is not a signing key file (a P-256 private key in JWK form). Nothing was written.`)
  }
  if (header && pub !== header.publicKey) {
    throw new UserError(`The key in ${file} (key id ${keyIdOf(pub)}) is not this ledger's key (key id ${header.keyId}): records signed with it would not verify. Nothing was written.`)
  }
  let privateKey
  try {
    privateKey = await importPrivateJwk(jwk)
  } catch {
    throw new UserError(`${file} does not hold a usable private key. Nothing was written.`)
  }
  if (!(await keyMatches(privateKey, pub))) throw new UserError(`The private part of ${file} does not belong to its public key. Nothing was written.`)
  if (out && process.platform !== 'win32') {
    try {
      if (statSync(file).mode & 0o077) out.warn(`The key file ${file} can be read by other users of this computer; only its owner should (chmod 600).`)
    } catch { /* checked above */ }
  }
  return { privateKey, publicKeyHex: pub, keyId: keyIdOf(pub), file, created: false }
}
