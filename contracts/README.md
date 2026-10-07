> Note: the alpha console’s publishing UI is paused while immutableqc.com is redesigned; this contract stays in the repository for the Filecoin roadmap.

# RootRegistry

Minimal attestation contract for Immutable QC. Each batch of sealed QC records is hashed into a Merkle root in the browser; `attest()` records that root on the Filecoin EVM with the publisher, epoch, timestamp, and the ledger sequence range it covers. A root can only be attested once.

| | |
|---|---|
| Source | `RootRegistry.sol` |
| Compiler | solc 0.8.28, optimizer on (200 runs), EVM target `paris` |
| Networks | Filecoin Calibration (chain id 314159), Filecoin Mainnet (chain id 314) |
| License | MIT OR Apache-2.0 |

## Interface

```solidity
function attest(bytes32 root, uint64 fromSeq, uint64 toSeq, string calldata batchId) external;
function attestation(bytes32 root) external view
    returns (address publisher, uint64 blockNumber, uint64 timestamp, uint64 fromSeq, uint64 toSeq);
function isAttested(bytes32 root) external view returns (bool);
function count() external view returns (uint256);

event RootAttested(bytes32 indexed root, address indexed publisher, uint64 fromSeq, uint64 toSeq, string batchId, uint256 timestamp);
```

Errors: `EmptyRoot()`, `RootAlreadyAttested(bytes32 root)`.

## Build and test

```sh
cd contracts
npm install
npm run build   # compiles, writes ../dashboard/registry-artifact.js and out/RootRegistry.json
npm test        # in-memory EVM: deploy, attest, event, duplicate guard, ABI codec vs ethers
```

The dashboard has no bundler and no web3 library. `dashboard/registry-abi.js` hand-encodes the four calls above; `npm test` checks it byte-for-byte against ethers so the two cannot drift.

## Deploy

The console no longer deploys or publishes (see the note above). The bytecode and ABI are in `out/RootRegistry.json` after `npm run build`. No shared deployment exists yet; once one does, its address can be published in one place for the site and the console to read.

## Verify on Blockscout

Calibration: https://filecoin-testnet.blockscout.com · Mainnet: https://filecoin.blockscout.com

Verify as a single Solidity file with: compiler `v0.8.28+commit.7893614a`, EVM version `paris`, optimization enabled, 200 runs, no constructor arguments. `out/RootRegistry.json` holds the full standard-JSON metadata if the UI asks for it.

## Read it without the app

Any JSON-RPC client can confirm a root. `attestation(bytes32)` selector is `0x1a7fca86`:

```sh
curl -s https://api.calibration.node.glif.io/rpc/v1 -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"eth_call",
  "params":[{"to":"<registry address>","data":"0x1a7fca86<64-hex-root>"},"latest"]}'
```

A non-zero publisher in the first word means the root is attested.
