#!/usr/bin/env node
/* In-memory EVM test for RootRegistry. No network needed.
   Also exercises the hand-rolled ABI encoder the dashboard uses (dashboard/registry-abi.js)
   against ethers' reference encoder, so the two can never drift apart. */
"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const { VM } = require("@ethereumjs/vm");
const { Common, Hardfork } = require("@ethereumjs/common");
const { Block } = require("@ethereumjs/block");
const { Address, hexToBytes, bytesToHex } = require("@ethereumjs/util");
const { Interface, AbiCoder } = require("ethers");

const artifact = JSON.parse(fs.readFileSync(path.join(__dirname, "out", "RootRegistry.json"), "utf8"));
const iface = new Interface(artifact.abi);

// Load the browser-side artifact + encoder in a tiny fake window, twice:
// once with the generated artifact present, once without (fallback selectors).
const abiSrc = fs.readFileSync(path.join(__dirname, "..", "dashboard", "registry-abi.js"), "utf8");
const artSrc = fs.readFileSync(path.join(__dirname, "..", "dashboard", "registry-artifact.js"), "utf8");
const win = {};
new Function("window", artSrc)(win);
new Function("window", abiSrc)(win);
const enc = win.IQC_ABI;
const bare = {};
new Function("window", abiSrc)(bare);
for (const fn of ["attest", "attestation", "isAttested", "count"]) {
  const sel = "0x" + Object.entries(win.IQC_REGISTRY.selectors).find(([k]) => k === fn)[1].slice(2);
  assert.strictEqual(win.IQC_REGISTRY.selectors[fn], sel);
}
assert.strictEqual(bare.IQC_ABI.encodeAttest("0x" + "11".repeat(32), 1, 2, "x"), enc.encodeAttest("0x" + "11".repeat(32), 1, 2, "x"), "fallback selector for attest drifted from artifact");
assert.strictEqual(bare.IQC_ABI.encodeAttestation("0x" + "11".repeat(32)), enc.encodeAttestation("0x" + "11".repeat(32)), "fallback selector for attestation drifted");
assert.strictEqual(bare.IQC_ABI.encodeIsAttested("0x" + "11".repeat(32)), enc.encodeIsAttested("0x" + "11".repeat(32)), "fallback selector for isAttested drifted");
assert.strictEqual(bare.IQC_ABI.encodeCount(), enc.encodeCount(), "fallback selector for count drifted");

(async () => {
  const common = new Common({ chain: 1, hardfork: Hardfork.Paris });
  const vm = await VM.create({ common });
  const alice = Address.fromString("0x00000000000000000000000000000000000a11ce");
  const bob = Address.fromString("0x0000000000000000000000000000000000000b0b");

  // Deploy.
  const deploy = await vm.evm.runCall({ caller: alice, data: hexToBytes(artifact.bytecode), gasLimit: 5_000_000n });
  assert.strictEqual(deploy.execResult.exceptionError, undefined, "deploy reverted");
  const registry = deploy.createdAddress;
  assert.ok(registry, "no contract address");
  console.log("deployed at", registry.toString(), "gas", deploy.execResult.executionGasUsed.toString());

  // Filecoin-like block context: 30 s epochs, a real timestamp.
  const BLOCK_NUMBER = 3_200_000n;
  const BLOCK_TIME = 1_790_000_000n;
  const block = Block.fromBlockData({ header: { number: BLOCK_NUMBER, timestamp: BLOCK_TIME, gasLimit: 30_000_000n } }, { common });

  async function call(caller, calldata) {
    const r = await vm.evm.runCall({ caller, to: registry, data: hexToBytes(calldata), gasLimit: 1_000_000n, block });
    return r.execResult;
  }
  function hexOf(bytes) { return bytesToHex(bytes); }

  const root = "0x" + "ab".repeat(32);
  const batchId = "cmt-7a3c9e12";

  // 1. Browser encoder must match ethers exactly.
  const ref = iface.encodeFunctionData("attest", [root, 1, 3, batchId]);
  const ours = enc.encodeAttest(root, 1, 3, batchId);
  assert.strictEqual(ours, ref, "attest calldata mismatch\n ours " + ours + "\n ref  " + ref);
  assert.strictEqual(enc.encodeAttestation(root), iface.encodeFunctionData("attestation", [root]));
  assert.strictEqual(enc.encodeIsAttested(root), iface.encodeFunctionData("isAttested", [root]));
  assert.strictEqual(enc.encodeCount(), iface.encodeFunctionData("count", []));
  // Odd-length and multi-chunk strings too.
  for (const s of ["", "x", "a".repeat(31), "b".repeat(32), "c".repeat(33), "batch-µ-ünïcode-2026"]) {
    assert.strictEqual(enc.encodeAttest(root, 0, 0, s), iface.encodeFunctionData("attest", [root, 0, 0, s]), "string case failed: " + JSON.stringify(s));
  }
  console.log("encoder matches ethers");

  // 2. isAttested is false before publish.
  let r = await call(bob, enc.encodeIsAttested(root));
  assert.strictEqual(iface.decodeFunctionResult("isAttested", hexOf(r.returnValue))[0], false);

  // 3. attest emits the event and stores the attestation.
  r = await call(alice, ours);
  assert.strictEqual(r.exceptionError, undefined, "attest reverted");
  assert.strictEqual(r.logs.length, 1);
  const [addr, topics, data] = r.logs[0];
  assert.strictEqual(Address.fromString(hexOf(addr)).toString(), registry.toString());
  assert.strictEqual(hexOf(topics[0]), iface.getEvent("RootAttested").topicHash);
  assert.strictEqual(hexOf(topics[1]), root);
  assert.strictEqual("0x" + hexOf(topics[2]).slice(-40), alice.toString());
  const decoded = iface.decodeEventLog("RootAttested", hexOf(data), topics.map(hexOf));
  assert.strictEqual(decoded.batchId, batchId);
  assert.strictEqual(Number(decoded.fromSeq), 1);
  assert.strictEqual(Number(decoded.toSeq), 3);
  console.log("attest ok, gas", r.executionGasUsed.toString());

  r = await call(bob, enc.encodeAttestation(root));
  const a = iface.decodeFunctionResult("attestation", hexOf(r.returnValue));
  assert.strictEqual(a.publisher.toLowerCase(), alice.toString());
  assert.strictEqual(Number(a.fromSeq), 1);
  assert.strictEqual(Number(a.toSeq), 3);
  const parsed = enc.decodeAttestation(hexOf(r.returnValue));
  assert.strictEqual(parsed.publisher.toLowerCase(), alice.toString());
  assert.strictEqual(parsed.fromSeq, 1);
  assert.strictEqual(parsed.toSeq, 3);
  assert.strictEqual(parsed.blockNumber, Number(BLOCK_NUMBER));
  assert.strictEqual(parsed.timestamp, Number(BLOCK_TIME));
  assert.strictEqual(Number(decoded.timestamp), Number(BLOCK_TIME));

  r = await call(bob, enc.encodeIsAttested(root));
  assert.strictEqual(enc.decodeBool(hexOf(r.returnValue)), true);
  r = await call(bob, enc.encodeCount());
  assert.strictEqual(enc.decodeUint(hexOf(r.returnValue)), 1);

  // 4. A root can only be attested once, by anyone.
  r = await call(bob, enc.encodeAttest(root, 9, 9, "dup"));
  assert.ok(r.exceptionError, "duplicate attest should revert");
  const err = iface.parseError(hexOf(r.returnValue));
  assert.strictEqual(err.name, "RootAlreadyAttested");

  // 5. Zero root rejected.
  r = await call(bob, enc.encodeAttest("0x" + "00".repeat(32), 0, 0, "zero"));
  assert.strictEqual(iface.parseError(hexOf(r.returnValue)).name, "EmptyRoot");

  // 6. A second, different root from another publisher works.
  const root2 = "0x" + "cd".repeat(32);
  r = await call(bob, enc.encodeAttest(root2, 4, 6, "cmt-second"));
  assert.strictEqual(r.exceptionError, undefined);
  r = await call(alice, enc.encodeCount());
  assert.strictEqual(enc.decodeUint(hexOf(r.returnValue)), 2);

  console.log("all RootRegistry tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
