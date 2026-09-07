const GENESIS = "0".repeat(64);
const DEMO_FP = "iqc-demo/fp-7a3c9e";
const enc = new TextEncoder();

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
};

async function sha256Hex(data) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(data));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function shortHash(h) {
  return h.slice(0, 10) + "…" + h.slice(-4);
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
    .replaceAll("&", "&")
    .replaceAll("<", "<")
    .replaceAll(">", ">")
    .replaceAll('"', """);
}

function go(view) {
  state.view = view;
  render();
}

async function ingest(id) {
  if (state.ingesting) return;
  state.ingesting = true;
  render();
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
  const seeded = await seed();
  state.packets = seeded.packets;
  state.commitments = seeded.commitments;
  state.chain = await verifyChain(state.packets);
  state.tamperedSeq = null;
  state.labName = "IQC Alpha Lab";
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
  const head = ordered.at(-1)?.hashes.record_sha256 || GENESIS;
  const last = state.commitments.at(-1);
  return `
    <p class="kicker">Open Alpha · v0.1</p>
    <h1>${esc(state.labName)}</h1>
    <p class="intro">Working console with synthetic packets. HPLC/MS capture adapters are in progress — ingest is file/demo only.</p>
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
    <div class="row-actions">
      <a class="btn btn--primary" href="#instruments">Ingest a demo run</a>
      <a class="btn btn--secondary" href="#ledger">Verify chain</a>
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
  return `
    <h1>Public cryptographic registry</h1>
    <p class="intro">Periodic Merkle roots of signed packets. Not a token, wallet, or mint.</p>
    <p class="hash">${pending} packet(s) waiting for the next batch of 3.</p>
    ${state.commitments
      .slice()
      .reverse()
      .map(
        (c) => `<article class="panel">
      <p class="hash">${esc(c.id)}</p>
      <p class="intro">${new Date(c.created_at).toLocaleString()} · seq ${c.from_seq}–${c.to_seq}</p>
      <p class="hash">root ${esc(shortHash(c.merkle_root))}</p>
    </article>`,
      )
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
    <p class="intro">Single-lab demo workspace. No accounts.</p>
    <label class="intro" for="lab">Lab name</label>
    <input id="lab" value="${esc(state.labName)}">
    <div class="row-actions">
      <button class="btn btn--primary" id="export">Export audit bundle</button>
      <button class="btn btn--secondary" id="reset">Reset synthetic lab</button>
    </div>`;
}

function render() {
  renderNav();
  const app = document.getElementById("app");
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
}

document.addEventListener("click", async (e) => {
  const a = e.target.closest("a[href^='#']");
  if (a) {
    e.preventDefault();
    go(a.getAttribute("href").slice(1));
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

seed().then(async (seeded) => {
  state.packets = seeded.packets;
  state.commitments = seeded.commitments;
  state.chain = await verifyChain(state.packets);
  const id = location.hash.slice(1);
  if (NAV.some((n) => n.id === id)) state.view = id;
  render();
});
