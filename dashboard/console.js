const GENESIS = "0".repeat(64);
const DEMO_FP = "iqc-demo/fp-7a3c9e";
const enc = new TextEncoder();

const BASE_SEPOLIA = {
  chainId: "0x14a34",
  chainIdDec: 84532,
  chainName: "Base Sepolia",
  rpcUrls: ["https://sepolia.base.org"],
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  blockExplorerUrls: ["https://sepolia.basescan.org"],
  faucet: "https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet",
  // Coinbase/smart wallets reject calldata to the user's own ("internal") account.
  // Publish sends 0-ETH + root calldata to this public sink instead (TESTNET attestation).
  attestationSink: "0x000000000000000000000000000000000000dEaD",
};

const INSTRUMENTS = [
  { id: "HPLC-01", name: "Alliance HPLC", type: "HPLC", protocol: "TCP/IP", firmware: "emp3-4.2.1", captureStatus: "in-progress", lastHeartbeat: "2026-09-07T15:48:00.000Z" },
  { id: "MS-02", name: "QToF Mass Spec", type: "MS", protocol: "TCP/IP", firmware: "masslynx-4.2", captureStatus: "in-progress", lastHeartbeat: "2026-09-07T15:46:22.000Z" },
  { id: "PH-BENCH", name: "Bench pH meter", type: "pH", protocol: "RS-232", firmware: "ph-2.11", captureStatus: "live-file", lastHeartbeat: "2026-09-07T15:50:11.000Z" },
  { id: "ENV-RACK", name: "Environmental rack", type: "env", protocol: "file-watcher", firmware: "env-1.0.8", captureStatus: "live-file", lastHeartbeat: "2026-09-07T15:50:40.000Z" },
];

const DEMOS = {
  "HPLC-01": [
    { analyte: "Caffeine", method_id: "USP-caff-01", value: 12.41, unit: "µg/mL", qc_level: "QC1" },
    { analyte: "Ibuprofen", method_id: "USP-ibu-02", value: 98.2, unit: "%", qc_level: "assay" },
  ],
  "MS-02": [{ analyte: "Nitrosamine NDMA", method_id: "MS-ndma-3", value: 0.18, unit: "ng/mL", qc_level: "LOQ" }],
  "PH-BENCH": [{ analyte: "Buffer pH", method_id: "pH-buf-a", value: 7.12, unit: "pH", qc_level: "cal" }],
  "ENV-RACK": [{ analyte: "Lab temperature", method_id: "env-t-1", value: 21.4, unit: "°C", qc_level: "monitor" }],
};

const NAV = [
  { id: "dash", label: "Dashboard" },
  { id: "instruments", label: "Instruments" },
  { id: "packets", label: "QC packets" },
  { id: "ledger", label: "Ledger" },
  { id: "registry", label: "Registry" },
  { id: "auditor", label: "Auditor" },
  { id: "settings", label: "Settings" },
];

const state = {
  labName: "IQC Alpha Lab",
  view: "dash",
  packets: [],
  commitments: [],
  chain: { ok: true },
  tamperedSeq: null,
  selectedPacket: null,
  ingesting: false,
  bootError: null,
  wallet: {
    address: null,
    chainId: null,
    status: "disconnected",
    error: null,
    publishingId: null,
  },
};

async function sha256Hex(data) {
  if (!crypto || !crypto.subtle) {
    throw new Error("Web Crypto unavailable (need HTTPS or localhost).");
  }
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(data));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function shortHash(h) {
  return h.slice(0, 10) + "…" + h.slice(-4);
}

function shortAddr(a) {
  if (!a) return "";
  return a.slice(0, 6) + "…" + a.slice(-4);
}

function basescanTxUrl(txHash) {
  const h = String(txHash || "");
  return "https://sepolia.basescan.org/tx/" + (h.startsWith("0x") ? h : "0x" + h);
}

const ONCHAIN_STORE_KEY = "iqc-onchain-v1";

function loadOnchainStore() {
  try {
    return JSON.parse(localStorage.getItem(ONCHAIN_STORE_KEY) || "{}") || {};
  } catch (err) {
    return {};
  }
}

function saveOnchainStore(store) {
  try {
    localStorage.setItem(ONCHAIN_STORE_KEY, JSON.stringify(store));
  } catch (err) {}
}

function persistOnchain(commitment) {
  if (!commitment || !commitment.onchain || !commitment.onchain.txHash) return;
  const store = loadOnchainStore();
  store[commitment.id] = commitment.onchain;
  store["root:" + commitment.merkle_root] = commitment.onchain;
  saveOnchainStore(store);
}

function restoreOnchain(commitments) {
  const store = loadOnchainStore();
  return commitments.map((c) => {
    const hit = store[c.id] || store["root:" + c.merkle_root];
    return hit ? { ...c, onchain: hit } : c;
  });
}

function renderPublishedTx(onchain) {
  if (!onchain || !onchain.txHash) return "";
  const tx = onchain.txHash;
  const url = basescanTxUrl(tx);
  return `<div class="tx-result">
      <p class="ok">Published on Base Sepolia · TESTNET</p>
      <p class="hash">tx ${esc(tx)}</p>
      <div class="row-actions">
        <a class="btn btn--primary" href="${esc(url)}" target="_blank" rel="noopener">View on Basescan</a>
        <button class="btn btn--secondary" data-copy-tx="${esc(tx)}">Copy tx hash</button>
      </div>
    </div>`;
  }

function canonical(p) {
  return JSON.stringify({
    packet_id: p.packet_id,
    seq: p.seq,
    captured_at: p.captured_at,
    instrument: p.instrument,
    measurement: p.measurement,
    calibration: p.calibration,
    operator_id: p.operator_id,
  });
}

async function signRecord(recordSha) {
  return sha256Hex("IQC-DEMO-KEY-v0.1|" + recordSha);
}

function demoMeasurement(id, n) {
  const options = DEMOS[id] || DEMOS["PH-BENCH"];
  const base = options[n % options.length];
  const jitter = ((n % 7) - 3) * 0.01;
  return { ...base, value: Number((base.value + jitter).toFixed(3)) };
}

async function seal(draft, prev) {
  const payload = canonical(draft);
  const payload_sha256 = await sha256Hex(payload);
  const record_sha256 = await sha256Hex(payload_sha256 + "|" + prev + "|" + draft.seq);
  const sig = await signRecord(record_sha256);
  return {
    ...draft,
    commitment_batch_id: null,
    hashes: { payload_sha256, prev_record_sha256: prev, record_sha256 },
    signature: { alg: "DEMO-SHA256", pubkey_fingerprint: DEMO_FP, sig },
  };
}

async function merkleRoot(hashes) {
  if (!hashes.length) return GENESIS;
  let layer = hashes.slice();
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i];
      const b = layer[i + 1] || layer[i];
      next.push(await sha256Hex(a + b));
    }
    layer = next;
  }
  return layer[0];
}

async function verifyPacket(packet, prev) {
  const reasons = [];
  const payloadHash = await sha256Hex(canonical(packet));
  if (payloadHash !== packet.hashes.payload_sha256) reasons.push("Payload hash mismatch.");
  if (packet.hashes.prev_record_sha256 !== prev) reasons.push("Previous-record hash mismatch.");
  const recordHash = await sha256Hex(payloadHash + "|" + packet.hashes.prev_record_sha256 + "|" + packet.seq);
  if (recordHash !== packet.hashes.record_sha256) reasons.push("Record hash mismatch.");
  if ((await signRecord(packet.hashes.record_sha256)) !== packet.signature.sig) reasons.push("Demo signature invalid.");
  return { ok: reasons.length === 0, reasons };
}

async function verifyChain(packets) {
  const ordered = packets.slice().sort((a, b) => a.seq - b.seq);
  let prev = GENESIS;
  for (const p of ordered) {
    const r = await verifyPacket(p, prev);
    if (!r.ok) return { ok: false, breakAt: p.seq, reason: r.reasons[0] };
    prev = p.hashes.record_sha256;
  }
  return { ok: true };
}

async function commitIfDue(packets, commitments) {
  const unbatched = packets.filter((p) => !p.commitment_batch_id);
  if (unbatched.length < 3) return { packets, commitments };
  const batch = unbatched.slice(0, 3);
  const id = "cmt-" + Math.random().toString(16).slice(2, 10);
  const root = await merkleRoot(batch.map((p) => p.hashes.record_sha256));
  const commitment = {
    id,
    created_at: new Date().toISOString(),
    merkle_root: root,
    from_seq: batch[0].seq,
    to_seq: batch[batch.length - 1].seq,
    packet_ids: batch.map((p) => p.packet_id),
    onchain: null,
  };
  return {
    packets: packets.map((p) => (batch.some((b) => b.packet_id === p.packet_id) ? { ...p, commitment_batch_id: id } : p)),
    commitments: commitments.concat(commitment),
  };
}

async function seed() {
  const drafts = [
    { inst: "HPLC-01", at: "2026-09-07T13:02:00.000Z", n: 0 },
    { inst: "MS-02", at: "2026-09-07T13:18:00.000Z", n: 0 },
    { inst: "PH-BENCH", at: "2026-09-07T13:41:00.000Z", n: 0 },
    { inst: "ENV-RACK", at: "2026-09-07T14:05:00.000Z", n: 0 },
    { inst: "HPLC-01", at: "2026-09-07T14:22:00.000Z", n: 1 },
  ];
  const packets = [];
  let prev = GENESIS;
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    const inst = INSTRUMENTS.find((x) => x.id === d.inst);
    const sealed = await seal(
      {
        packet_id: "pkt-seed-" + String(i + 1).padStart(2, "0"),
        seq: i + 1,
        captured_at: d.at,
        instrument: { id: inst.id, type: inst.type, protocol: inst.protocol, firmware: inst.firmware },
        measurement: demoMeasurement(d.inst, d.n),
        calibration: { cal_id: "cal-" + inst.id + "-2026-08", valid_until: "2026-10-01T00:00:00.000Z" },
        operator_id: i % 2 === 0 ? "op.reyes" : null,
      },
      prev,
    );
    packets.push(sealed);
    prev = sealed.hashes.record_sha256;
  }
  return commitIfDue(packets, []);
}

function esc(s) {
  return String(s)
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;");
}

function go(view) {
  state.view = view;
  render();
}

function onCorrectChain() {
  return Number(state.wallet.chainId) === BASE_SEPOLIA.chainIdDec || state.wallet.chainId === BASE_SEPOLIA.chainId;
}

const eip6963Providers = [];

function isUsableProvider(p) {
  return !!(p && typeof p.request === "function");
}

function providerInfo(detail) {
  // EIP-6963 detail: { info, provider }
  if (detail && detail.provider) return detail;
  return null;
}

function rememberEip6963(detail) {
  const item = providerInfo(detail);
  if (!item || !isUsableProvider(item.provider)) return;
  const rdns = item.info && item.info.rdns;
  const exists = eip6963Providers.some((x) => (rdns && x.info && x.info.rdns === rdns) || x.provider === item.provider);
  if (!exists) eip6963Providers.push(item);
}

function requestEip6963Providers() {
  try {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  } catch (err) {}
}

function collectInjectedProviders() {
  const list = [];
  try {
    for (const item of eip6963Providers) {
      if (item && item.provider) list.push(item.provider);
    }
    const eth = typeof window !== "undefined" ? window.ethereum : null;
    if (eth) {
      if (Array.isArray(eth.providers)) list.push(...eth.providers);
      if (Array.isArray(eth)) list.push(...eth);
      list.push(eth);
    }
  } catch (err) {}
  const unique = [];
  for (const p of list) {
    if (p && unique.indexOf(p) === -1) unique.push(p);
  }
  return unique;
}

function ethereum() {
  try {
    const unique = collectInjectedProviders();
    if (!unique.length) return null;

    // Prefer MetaMask by flag or EIP-6963 rdns
    const byRdns = eip6963Providers.find(
      (x) => x.info && /metamask/i.test(String(x.info.rdns || x.info.name || "")) && isUsableProvider(x.provider),
    );
    if (byRdns) return byRdns.provider;

    const metamask = unique.find((p) => p && p.isMetaMask && isUsableProvider(p));
    if (metamask) return metamask;

    // Some MetaMask builds expose provider under providers without isMetaMask on the top-level shim
    const nested = unique.find((p) => p && p.provider && p.provider.isMetaMask && isUsableProvider(p.provider));
    if (nested) return nested.provider;

    const any = unique.find(isUsableProvider);
    if (any) return any;
    return null;
  } catch (err) {
    return null;
  }
}

function hasAnyWalletInjection() {
  try {
    if (eip6963Providers.length) return true;
    if (typeof window !== "undefined" && window.ethereum) return true;
  } catch (err) {}
  return false;
}

function providerErrorMessage() {
  if (hasAnyWalletInjection()) {
    return "Wallet detected but not usable yet. Open the MetaMask extension, unlock it, set it as your default wallet, disable other wallet extensions, then click Connect again.";
  }
  return "MetaMask was not detected in this browser tab. Open MetaMask, unlock it, then click Connect. If you use a different browser profile, install/enable MetaMask there.";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveProvider(timeoutMs) {
  requestEip6963Providers();
  const started = Date.now();
  let eth = ethereum();
  while (!eth && Date.now() - started < timeoutMs) {
    await wait(100);
    requestEip6963Providers();
    eth = ethereum();
  }
  return eth;
}

async function ensureBaseSepolia() {
  const eth = ethereum() || (await resolveProvider(800));
  if (!eth) throw new Error("MetaMask not detected in this tab");
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_SEPOLIA.chainId }],
    });
  } catch (err) {
    if (err && (err.code === 4902 || String(err.message || "").includes("Unrecognized chain"))) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: BASE_SEPOLIA.chainId,
            chainName: BASE_SEPOLIA.chainName,
            rpcUrls: BASE_SEPOLIA.rpcUrls,
            nativeCurrency: BASE_SEPOLIA.nativeCurrency,
            blockExplorerUrls: BASE_SEPOLIA.blockExplorerUrls,
          },
        ],
      });
    } else {
      throw err;
    }
  }
  const chainId = await eth.request({ method: "eth_chainId" });
  state.wallet.chainId = chainId;
}

async function connectWallet() {
  state.wallet.error = null;
  state.wallet.status = "connecting";
  render();
  try {
    const eth = await resolveProvider(1500);
    if (!eth || typeof eth.request !== "function") {
      state.wallet.status = hasAnyWalletInjection() ? "disconnected" : "missing";
      state.wallet.error = providerErrorMessage();
      render();
      return;
    }
    const accounts = await eth.request({ method: "eth_requestAccounts" });
    state.wallet.address = accounts[0] || null;
    await ensureBaseSepolia();
    state.wallet.status = state.wallet.address ? "connected" : "disconnected";
    if (!onCorrectChain()) {
      state.wallet.error = "Wrong network. Switch to Base Sepolia (TESTNET) to publish.";
    }
    attachWalletListeners();
  } catch (err) {
    state.wallet.status = "disconnected";
    state.wallet.error = (err && err.message) || "Connection rejected.";
  }
  render();
}

function disconnectWallet() {
  state.wallet.address = null;
  state.wallet.chainId = null;
  state.wallet.status = "disconnected";
  state.wallet.error = null;
  state.wallet.publishingId = null;
  render();
}

function attachWalletListeners() {
  try {
    if (typeof window !== "undefined" && !window.__iqcEip6963) {
      window.__iqcEip6963 = true;
      window.addEventListener("eip6963:announceProvider", (event) => {
        rememberEip6963(event.detail);
        if (state.wallet.status === "missing") {
          state.wallet.status = "disconnected";
          state.wallet.error = null;
          render();
        }
      });
      requestEip6963Providers();
      window.addEventListener(
        "ethereum#initialized",
        () => {
          if (state.wallet.status === "missing" && ethereum()) {
            state.wallet.status = "disconnected";
            state.wallet.error = null;
            render();
          }
        },
        { once: true },
      );
    }
    const eth = ethereum();
    if (!eth || eth.__iqcListeners) return;
    eth.__iqcListeners = true;
    if (typeof eth.on === "function") {
      eth.on("accountsChanged", (accounts) => {
        state.wallet.address = accounts && accounts[0] ? accounts[0] : null;
        if (!state.wallet.address) {
          state.wallet.status = "disconnected";
        }
        render();
      });
      eth.on("chainChanged", (chainId) => {
        state.wallet.chainId = chainId;
        if (!onCorrectChain()) {
          state.wallet.error = "Wrong network. Switch to Base Sepolia (TESTNET) to publish.";
        } else {
          state.wallet.error = null;
        }
        render();
      });
    }
  } catch (err) {
    console.warn("IQC wallet listeners skipped", err);
  }
}

async function publishCommitment(id) {
  const c = state.commitments.find((x) => x.id === id);
  if (!c) return;
  state.wallet.error = null;
  state.wallet.lastPublishError = null;
  state.wallet.publishingId = id;
  render();

  try {
    if (!state.wallet.address) {
      await connectWallet();
      if (!state.wallet.address) {
        state.wallet.publishingId = null;
        render();
        return;
      }
    }
    const eth = (await resolveProvider(1500)) || ethereum();
    if (!eth || typeof eth.request !== "function") {
      state.wallet.status = "missing";
      state.wallet.error = providerErrorMessage();
      state.wallet.publishingId = null;
      render();
      return;
    }
    await ensureBaseSepolia();
    if (!onCorrectChain()) {
      state.wallet.error = "Wrong network. Switch to Base Sepolia before publishing.";
      state.wallet.publishingId = null;
      render();
      return;
    }
    const rootHex = c.merkle_root.startsWith("0x") ? c.merkle_root : "0x" + c.merkle_root;
    // 0-ETH attestation tx: root in calldata, NOT to self (smart wallets block data→internal).
    const sink = BASE_SEPOLIA.attestationSink;
    const txParams = {
      from: state.wallet.address,
      to: sink,
      value: "0x0",
      data: rootHex,
    };
    try {
      const gas = await eth.request({ method: "eth_estimateGas", params: [txParams] });
      if (gas) txParams.gas = gas;
    } catch (err) {
      // Wallet will estimate if omitted
    }
    let txHash;
    try {
      txHash = await eth.request({
        method: "eth_sendTransaction",
        params: [txParams],
      });
    } catch (err) {
      const msg = String((err && (err.message || err.data && err.data.message)) || err || "");
      if (/internal accounts cannot include data/i.test(msg) || /cannot include data/i.test(msg)) {
        // Last resort: still avoid self; rethrow with clearer guidance
        throw new Error(
          "This wallet blocks calldata to your own account. Publishing now uses a public sink (" +
            sink +
            "). Hard-refresh and retry; if it still fails, use MetaMask extension (EOA) on Base Sepolia.",
        );
      }
      throw err;
    }
    c.onchain = {
      network: "Base Sepolia",
      chainId: BASE_SEPOLIA.chainIdDec,
      txHash,
      merkle_root: c.merkle_root,
      to: sink,
      published_at: new Date().toISOString(),
      label: "TESTNET",
      explorer: basescanTxUrl(txHash),
    };
    persistOnchain(c);
    state.wallet.lastTxHash = txHash;
    state.view = "registry";
  } catch (err) {
    const msg = (err && (err.message || err.data?.message)) || String(err);
    const low = msg.toLowerCase();
    if (low.includes("insufficient funds") || low.includes("insufficient balance") || err.code === -32000) {
      state.wallet.error =
        "Needs Base Sepolia ETH to publish. Get testnet ETH from a faucet, then retry.";
    } else if (low.includes("user rejected") || err.code === 4001) {
      state.wallet.error = "Publish cancelled in MetaMask.";
    } else if (low.includes("internal accounts cannot include data") || low.includes("cannot include data")) {
      state.wallet.error =
        "Wallet blocked calldata to your account. Hard-refresh — publish now targets a public sink. Prefer MetaMask EOA if it still fails.";
    } else {
      state.wallet.error = msg;
    }
    state.wallet.lastPublishError = state.wallet.error;
  }
  state.wallet.publishingId = null;
  render();
}

async function ingest(id) {
  if (state.ingesting) return;
  state.ingesting = true;
  render();
  try {
    const inst = INSTRUMENTS.find((x) => x.id === id);
    const ordered = state.packets.slice().sort((a, b) => a.seq - b.seq);
    const prev = ordered.length ? ordered[ordered.length - 1].hashes.record_sha256 : GENESIS;
    const seq = (ordered[ordered.length - 1]?.seq || 0) + 1;
    const sealed = await seal(
      {
        packet_id: "pkt-" + Math.random().toString(16).slice(2, 10),
        seq,
        captured_at: new Date().toISOString(),
        instrument: { id: inst.id, type: inst.type, protocol: inst.protocol, firmware: inst.firmware },
        measurement: demoMeasurement(id, seq),
        calibration: { cal_id: "cal-" + inst.id + "-2026-08", valid_until: "2026-10-01T00:00:00.000Z" },
        operator_id: "op.reyes",
      },
      prev,
    );
    const next = await commitIfDue(state.packets.concat(sealed), state.commitments);
    state.packets = next.packets;
    state.commitments = next.commitments;
    state.chain = await verifyChain(state.packets);
    state.tamperedSeq = null;
  } catch (err) {
    state.bootError = (err && err.message) || String(err);
  }
  state.ingesting = false;
  render();
}

async function tamper() {
  const ordered = state.packets.slice().sort((a, b) => a.seq - b.seq);
  const seq = ordered[Math.floor(ordered.length / 2)]?.seq;
  if (!seq) return;
  state.packets = state.packets.map((p) =>
    p.seq === seq ? { ...p, measurement: { ...p.measurement, value: Number((p.measurement.value + 1.11).toFixed(3)) } } : p,
  );
  state.tamperedSeq = seq;
  state.chain = await verifyChain(state.packets);
  render();
}

async function resetLab() {
  try {
    const seeded = await seed();
    state.packets = seeded.packets;
    state.commitments = restoreOnchain(seeded.commitments);
    state.chain = await verifyChain(state.packets);
    state.tamperedSeq = null;
    state.labName = "IQC Alpha Lab";
    state.bootError = null;
  } catch (err) {
    state.bootError = (err && err.message) || String(err);
  }
  render();
}

function exportBundle() {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          exported_at: new Date().toISOString(),
          lab: state.labName,
          disclaimer: "DEMO / SYNTHETIC DATA.",
          chain: state.chain,
          commitments: state.commitments,
          packets: state.packets,
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "iqc-audit-bundle.json";
  a.click();
}

function renderWalletBar() {
  const el = document.getElementById("walletBar");
  if (!el) return;
  const w = state.wallet;
  let body = "";
  if (w.address) {
    const net = onCorrectChain()
      ? '<span class="ok">Base Sepolia</span>'
      : '<span class="bad">Wrong network</span>';
    body = `<span class="wallet__meta">TESTNET · ${net} · <span class="hash">${esc(shortAddr(w.address))}</span></span>
      ${!onCorrectChain() ? '<button class="btn btn--primary" id="switchChain">Switch to Base Sepolia</button>' : ""}
      <button class="btn btn--secondary" id="disconnectWallet">Disconnect</button>`;
  } else {
    body = `<span class="wallet__meta">TESTNET · Base Sepolia · registry publish only</span>
      <button class="btn btn--primary" id="connectWallet">${w.status === "connecting" ? "Connecting…" : "Connect MetaMask"}</button>
      <a class="btn btn--secondary" href="https://metamask.io/download/" target="_blank" rel="noopener">Get MetaMask</a>`;
  }
  el.innerHTML =
    body +
    (w.error
      ? `<p class="wallet__err bad">${esc(w.error)}${
          String(w.error).includes("Needs Base Sepolia ETH")
            ? ` · <a href="${BASE_SEPOLIA.faucet}" target="_blank" rel="noopener">faucet</a>`
            : ""
        }${
          w.status === "missing"
            ? ` · <a href="https://metamask.io/download/" target="_blank" rel="noopener">install</a>`
            : ""
        }</p>`
      : "");
}

function renderNav() {
  const links = NAV.map(
    (n) => `<a href="#${n.id}" class="${state.view === n.id ? "is-active" : ""}">${esc(n.label)}</a>`,
  ).join("");
  document.getElementById("nav").innerHTML = links;
  document.getElementById("mobileNav").innerHTML = NAV.slice(0, 4)
    .map((n) => `<a href="#${n.id}" class="${state.view === n.id ? "is-active" : ""}">${esc(n.label)}</a>`)
    .join("");
}

function viewDash() {
  const ordered = state.packets.slice().sort((a, b) => a.seq - b.seq);
  const head = (ordered.length ? ordered[ordered.length - 1].hashes.record_sha256 : GENESIS);
  const last = state.commitments.length ? state.commitments[state.commitments.length - 1] : null;
  return `
    <p class="kicker">Open Alpha · v0.1 · DEMO / SYNTHETIC DATA</p>
    <h1>${esc(state.labName)}</h1>
    <p class="intro">Working console with synthetic packets. HPLC/MS capture adapters are in progress — ingest is file/demo only. MetaMask on Base Sepolia is for publishing Merkle roots only (TESTNET).</p>
    <div class="stats">
      <div class="stat"><span>Signed packets</span><strong>${state.packets.length}</strong></div>
      <div class="stat"><span>Integrity</span><strong class="${state.chain.ok ? "ok" : "bad"}">${state.chain.ok ? "OK" : "Break @ " + state.chain.breakAt}</strong></div>
      <div class="stat"><span>Instruments</span><strong>${INSTRUMENTS.length}</strong></div>
      <div class="stat"><span>Commitments</span><strong>${state.commitments.length}</strong></div>
    </div>
    <div class="panel">
      <span class="kicker">Ledger head</span>
      <p class="hash">${esc(shortHash(head))}</p>
      <p class="intro">${last ? "Last registry commitment " + new Date(last.created_at).toLocaleString() : "No registry commitment yet — three unbatched packets trigger one."}</p>
    </div>
    <div class="panel">
      <p class="kicker">On-chain registry · Base Sepolia TESTNET</p>
      <p class="intro">Publish a Merkle root from the latest commitment batch. Sends a 0-ETH Base Sepolia tx with the root in calldata to a public attestation sink (not a token transfer).</p>
      ${
        last
          ? `<p class="hash">Latest commitment ${esc(last.id)} · root ${esc(shortHash(last.merkle_root))}</p>
             ${
               last.onchain && last.onchain.txHash
                 ? renderPublishedTx(last.onchain)
                 : `<div class="row-actions">
                      <button class="btn btn--primary" data-publish="${esc(last.id)}" ${state.wallet.publishingId === last.id ? "disabled" : ""}>${
                        state.wallet.publishingId === last.id
                          ? "Publishing…"
                          : state.wallet.address
                            ? "Publish root to Base Sepolia"
                            : "Connect & publish root"
                      }</button>
                      <a class="btn btn--secondary" href="#registry">All commitments</a>
                    </div>`
             }`
          : `<p class="intro">No commitment yet — ingest until a batch of 3 packets is sealed.</p>
             <div class="row-actions"><a class="btn btn--primary" href="#instruments">Ingest a demo run</a></div>`
      }
      ${state.wallet.error && state.wallet.publishingId === null ? `<p class="bad">${esc(state.wallet.error)}${String(state.wallet.error).includes("Needs Base Sepolia ETH") ? ` · <a href="${BASE_SEPOLIA.faucet}" target="_blank" rel="noopener">faucet</a>` : ""}</p>` : ""}
    </div>
    <div class="row-actions">
      <a class="btn btn--primary" href="#instruments">Ingest a demo run</a>
      <a class="btn btn--secondary" href="#ledger">Verify chain</a>
      <a class="btn btn--secondary" href="#registry">Registry</a>
    </div>`;
}

function viewInstruments() {
  return `
    <h1>Instruments</h1>
    <p class="intro">HPLC and MS adapters are marked in progress. Ingest generates a signed QC packet from a synthetic run.</p>
    ${INSTRUMENTS.map((inst) => {
      const last = state.packets.slice().reverse().find((p) => p.instrument.id === inst.id);
      return `<article class="panel">
        <h3>${esc(inst.name)} <span class="hash">${esc(inst.id)}</span></h3>
        <p class="${inst.captureStatus === "live-file" ? "ok" : "progress"}">${inst.captureStatus === "live-file" ? "file ingest live" : "capture adapter: in progress — file/CSV ingest only"}</p>
        <p class="intro">${esc(inst.protocol)} · firmware ${esc(inst.firmware)}</p>
        <p class="intro">${last ? "Last signed: " + last.measurement.analyte + " " + last.measurement.value + " " + last.measurement.unit + " · seq " + last.seq : "No signed run yet"}</p>
        <div class="row-actions"><button class="btn btn--primary" data-ingest="${inst.id}" ${state.ingesting ? "disabled" : ""}>${state.ingesting ? "Signing…" : "Ingest demo run"}</button></div>
      </article>`;
    }).join("")}`;
}

function viewPackets() {
  const ordered = state.packets.slice().sort((a, b) => b.seq - a.seq);
  const selected = state.packets.find((p) => p.packet_id === state.selectedPacket) || ordered[0];
  return `
    <h1>QC packets</h1>
    <p class="intro">Synthetic measurements. Select a row for the full packet.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Seq</th><th>Time</th><th>Instrument</th><th>Measurement</th><th>Hash</th></tr></thead>
      <tbody>
        ${ordered
          .map(
            (p) => `<tr data-pkt="${esc(p.packet_id)}">
          <td>${p.seq}</td><td>${new Date(p.captured_at).toLocaleString()}</td>
          <td>${esc(p.instrument.id)}</td>
          <td>${esc(p.measurement.analyte)} ${p.measurement.value} ${esc(p.measurement.unit)}</td>
          <td class="hash">${esc(shortHash(p.hashes.record_sha256))}</td></tr>`,
          )
          .join("")}
      </tbody>
    </table></div>
    ${
      selected
        ? `<div class="panel"><h3>Packet ${esc(selected.packet_id)}</h3>
      <button class="btn btn--secondary" id="verifyOne">Verify</button>
      <p class="intro" id="verifyOut">Run verify to check this packet.</p>
      <pre>${esc(JSON.stringify(selected, null, 2))}</pre></div>`
        : ""
    }`;
}

function viewLedger() {
  const ordered = state.packets.slice().sort((a, b) => a.seq - b.seq);
  return `
    <h1>Ledger</h1>
    <p class="intro">Append-only hash chain. Tamper a value without resigning and the walk fails.</p>
    <p class="${state.chain.ok ? "ok" : "bad"}">${state.chain.ok ? "Chain verifies." : "Integrity break at seq " + state.chain.breakAt + ": " + esc(state.chain.reason)}</p>
    <div class="row-actions">
      <button class="btn btn--secondary" id="verifyChain">Verify chain</button>
      <button class="btn btn--secondary" id="tamper">Simulate tamper</button>
      <button class="btn btn--secondary" id="reset">Reset lab</button>
    </div>
    ${ordered
      .map(
        (p) => `<article class="panel">
      <p class="hash">seq ${p.seq}${state.tamperedSeq === p.seq ? ' <span class="bad">tampered value</span>' : ""}</p>
      <p>${esc(p.instrument.id)} · ${esc(p.measurement.analyte)} ${p.measurement.value} ${esc(p.measurement.unit)}</p>
      <p class="hash">prev ${esc(shortHash(p.hashes.prev_record_sha256))}</p>
      <p class="hash">record ${esc(shortHash(p.hashes.record_sha256))}</p>
    </article>`,
      )
      .join("")}`;
}

function viewRegistry() {
  const pending = state.packets.filter((p) => !p.commitment_batch_id).length;
  const canWrite = state.wallet.address && onCorrectChain();
  return `
    <h1>Public cryptographic registry</h1>
    <p class="intro">Periodic Merkle roots of signed packets. Not a token, wallet login, or mint. Publish uses MetaMask on <strong>Base Sepolia (TESTNET)</strong> only.</p>
    <p class="hash">${pending} packet(s) waiting for the next batch of 3.</p>
    <div class="panel">
      <p class="kicker">Wallet</p>
      ${
        state.wallet.address
          ? `<p class="intro">${esc(shortAddr(state.wallet.address))} · ${onCorrectChain() ? '<span class="ok">Base Sepolia</span>' : '<span class="bad">Wrong network — writes blocked</span>'}</p>
             <div class="row-actions">
               ${!onCorrectChain() ? '<button class="btn btn--primary" id="switchChain">Switch to Base Sepolia</button>' : ""}
               <button class="btn btn--secondary" id="disconnectWallet">Disconnect</button>
             </div>`
          : `<div class="row-actions">
               <button class="btn btn--primary" id="connectWallet">${state.wallet.status === "connecting" ? "Connecting…" : "Connect MetaMask"}</button>
               <a class="btn btn--secondary" href="https://metamask.io/download/" target="_blank" rel="noopener">Get MetaMask</a>
             </div>
             <p class="intro">Unlock MetaMask in this browser profile, then Connect. Base Sepolia TESTNET only.</p>`
      }
      ${state.wallet.error ? `<p class="bad">${esc(state.wallet.error)}${String(state.wallet.error).includes("Needs Base Sepolia ETH") ? ` · <a href="${BASE_SEPOLIA.faucet}" target="_blank" rel="noopener">Get Base Sepolia ETH</a>` : ""}</p>` : ""}
    </div>
    ${state.commitments
      .slice()
      .reverse()
      .map((c) => {
        const publishing = state.wallet.publishingId === c.id;
        return `<article class="panel">
      <p class="hash">${esc(c.id)} · <span class="kicker">TESTNET</span></p>
      <p class="intro">${new Date(c.created_at).toLocaleString()} · seq ${c.from_seq}–${c.to_seq}</p>
      <p class="hash">root ${esc(c.merkle_root)}</p>
      ${
        c.onchain && c.onchain.txHash
          ? renderPublishedTx(c.onchain)
          : `<div class="row-actions"><button class="btn btn--primary" data-publish="${esc(c.id)}" ${publishing ? "disabled" : ""}>${publishing ? "Publishing…" : canWrite ? "Publish root to Base Sepolia" : "Connect & publish root"}</button></div>`
      }
    </article>`;
      })
      .join("") || '<p class="intro">No commitments yet.</p>'}`;
}

function viewAuditor() {
  const ordered = state.packets.slice().sort((a, b) => a.seq - b.seq);
  const selected = ordered.find((p) => p.packet_id === state.selectedPacket) || ordered[0];
  return `
    <p class="kicker">Planned portal · preview</p>
    <h1>Auditor view</h1>
    <p class="intro">Read-only verification without proprietary methods or raw chromatograms.</p>
    <label class="intro" for="pkt">Packet</label>
    <select id="pkt">${ordered.map((p) => `<option value="${esc(p.packet_id)}" ${selected && p.packet_id === selected.packet_id ? "selected" : ""}>seq ${p.seq} · ${esc(p.instrument.id)} · ${esc(p.measurement.analyte)}</option>`).join("")}</select>
    ${
      selected
        ? `<dl class="panel">
      <p>Captured ${esc(new Date(selected.captured_at).toISOString())}</p>
      <p>Instrument ${esc(selected.instrument.id)} (${esc(selected.instrument.type)})</p>
      <p>Method ${esc(selected.measurement.method_id)}</p>
      <p class="hash">Record ${esc(shortHash(selected.hashes.record_sha256))}</p>
      <p class="intro">Measurement value is omitted in this auditor summary.</p>
    </dl>`
        : ""
    }
    <div class="row-actions"><button class="btn btn--primary" id="verifyAud">Verify packet</button></div>
    <p class="intro" id="audOut"></p>`;
}

function viewSettings() {
  return `
    <h1>Settings</h1>
    <p class="intro">Single-lab demo workspace. No accounts. Wallet is local disconnect only.</p>
    <label class="intro" for="lab">Lab name</label>
    <input id="lab" value="${esc(state.labName)}">
    <div class="row-actions">
      <button class="btn btn--primary" id="export">Export audit bundle</button>
      <button class="btn btn--secondary" id="reset">Reset synthetic lab</button>
    </div>`;
}

function render() {
  const app = document.getElementById("app");
  try {
    renderNav();
    renderWalletBar();
    if (state.bootError) {
      app.innerHTML = `<div class="panel"><h1>Console error</h1><p class="bad">${esc(state.bootError)}</p><div class="row-actions"><button class="btn btn--primary" id="reset">Retry / reset lab</button></div></div>`;
      return;
    }
    const views = {
      dash: viewDash,
      instruments: viewInstruments,
      packets: viewPackets,
      ledger: viewLedger,
      registry: viewRegistry,
      auditor: viewAuditor,
      settings: viewSettings,
    };
    app.innerHTML = (views[state.view] || viewDash)();
  } catch (err) {
    console.error("IQC render failed", err);
    const msg = (err && err.message) || String(err);
    if (app) {
      app.innerHTML = `<div class="panel"><h1>Console error</h1><p class="bad">${esc(msg)}</p><div class="row-actions"><button class="btn btn--primary" id="reset">Retry / reset lab</button></div></div>`;
    }
  }
}

document.addEventListener("click", async (e) => {
  const a = e.target.closest("a[href^='#']");
  if (a) {
    e.preventDefault();
    go(a.getAttribute("href").slice(1));
    return;
  }
  if (e.target.id === "connectWallet" || e.target.closest("#connectWallet")) {
    await connectWallet();
    return;
  }
  if (e.target.id === "disconnectWallet" || e.target.closest("#disconnectWallet")) {
    disconnectWallet();
    return;
  }
  if (e.target.id === "switchChain" || e.target.closest("#switchChain")) {
    try {
      await ensureBaseSepolia();
      state.wallet.error = onCorrectChain() ? null : "Still on wrong network.";
    } catch (err) {
      state.wallet.error = (err && err.message) || String(err);
    }
    render();
    return;
  }
  const pub = e.target.closest("[data-publish]");
  if (pub) {
    await publishCommitment(pub.getAttribute("data-publish"));
    return;
  }
  const ingestBtn = e.target.closest("[data-ingest]");
  if (ingestBtn) {
    await ingest(ingestBtn.getAttribute("data-ingest"));
    return;
  }
  const pkt = e.target.closest("tr[data-pkt]");
  if (pkt) {
    state.selectedPacket = pkt.getAttribute("data-pkt");
    render();
    return;
  }
  if (e.target.id === "tamper") await tamper();
  if (e.target.id === "reset") await resetLab();
  if (e.target.id === "verifyChain") {
    state.chain = await verifyChain(state.packets);
    render();
  }
  if (e.target.id === "export") exportBundle();
  if (e.target.id === "verifyOne" || e.target.id === "verifyAud") {
    const ordered = state.packets.slice().sort((a, b) => a.seq - b.seq);
    const selected =
      state.packets.find((p) => p.packet_id === state.selectedPacket) || ordered[0];
    if (!selected) return;
    const prev = ordered.find((p) => p.seq === selected.seq - 1)?.hashes.record_sha256 || GENESIS;
    const r = await verifyPacket(selected, prev);
    const out = document.getElementById(e.target.id === "verifyAud" ? "audOut" : "verifyOut");
    if (out) out.textContent = r.ok ? "Valid — payload, chain link, and demo signature match." : r.reasons.join(" ");
  }
});

document.addEventListener("change", (e) => {
  if (e.target.id === "pkt") {
    state.selectedPacket = e.target.value;
    render();
  }
  if (e.target.id === "lab") state.labName = e.target.value;
});

window.addEventListener("hashchange", () => {
  const id = location.hash.slice(1);
  if (NAV.some((n) => n.id === id)) state.view = id;
  render();
});

attachWalletListeners();

(async function boot() {
  try {
    const seeded = await seed();
    state.packets = seeded.packets;
    state.commitments = restoreOnchain(seeded.commitments);
    state.chain = await verifyChain(state.packets);
    const id = location.hash.slice(1);
    if (NAV.some((n) => n.id === id)) state.view = id;
    state.bootError = null;
  } catch (err) {
    state.bootError = (err && err.message) || String(err);
    console.error("IQC boot failed", err);
  }
  render();
})();
