const packets = document.querySelector("#packets");
const ledgerEl = document.querySelector("#ledger");
const replayEl = document.querySelector("#replay");
const statusEl = document.querySelector("#status");
const marketEl = document.querySelector("#market");
const scoreButton = document.querySelector("#score");
const featured = ["harbor", "red-lantern"];
const memory = new Map();

const sheets = [
  ["Revenue", [["Trailing twelve months", "l"], ["Trailing three months", "m"]]],
  ["Cash and payables", [["Cash", "m"], ["Payables due in 30 days", "s"]]],
  ["Obligations", [["Monthly debt service", "s"], ["Returned payments, 90 days", "s"], ["Largest customer", "m"]]],
];

init();

async function init() {
  const companies = await api("/api/companies");
  packets.innerHTML = featured
    .map((id) => companies.find((company) => company.companyId === id))
    .map(renderPacket)
    .join("");
  await Promise.all([loadMarket(), loadLedger(), loadReplay()]);
  scoreButton.addEventListener("click", scoreBoth);
  document.querySelector("#reset").addEventListener("click", reset);
}

async function scoreBoth() {
  scoreButton.disabled = true;
  status("Asking NEAR AI Cloud for a fresh attestation on each company…");
  try {
    for (const id of featured) {
      const result = await api("/api/score", { method: "POST", body: { companyId: id } });
      memory.set(id, result);
      paint(id);
    }
    await loadLedger();
    status("Scored. The public record is under the packets. The ratios stay in this tab.");
  } catch (error) {
    status(error.message);
  } finally {
    scoreButton.disabled = false;
  }
}

function paint(id) {
  const card = document.querySelector(`[data-company="${id}"]`);
  const result = memory.get(id);
  if (!card || !result) return;
  const { line, privateView } = result;
  const passed = line.decision === "pass";
  card.querySelector(".stamp-slot").innerHTML = `<div class="stamp ${passed ? "pass" : "fail"}">${passed ? "Pass" : "Decline"}</div>`;
    const checks = (line.attestation?.checks || [])
    .map((check) => {
      const mark = check.pass ? "yes" : "open";
      const word = check.pass ? "Checked" : check.note ? "Not claimed" : "Failed";
      return `<li><span>${check.label}</span><b class="${mark}">${word}</b></li>`;
    })
    .join("");
  const ratios = privateView.ratios;
  card.querySelector(".result").innerHTML = `
    <div class="result-top">
      <p class="limit">${passed ? money(line.limitUsd) : "No line"}</p>
    </div>
    <p class="reasons">${passed ? "Reason codes: none." : `Reason codes: ${line.reasonCodes.join(", ")}`}</p>
    <ul class="checks">${checks}</ul>
    <p class="hash">Gateway ${short(line.attestation?.signingAddress)} · nonce ${short(line.attestation?.nonce)} · quote ${short(line.attestation?.quoteSha256)}</p>
    <details>
      <summary>Ratios for the person who uploaded the books. Not written to the record.</summary>
      <p>Runway ${ratios.runwayMonths.toFixed(2)} months. Trend ${ratios.trend.toFixed(2)}. DSCR ${ratios.dscr === null ? "no debt" : ratios.dscr.toFixed(2)}. Largest customer ${(ratios.concentration * 100).toFixed(0)}%.</p>
    </details>
    ${passed && line.attestation?.ok ? drawForm() : passed ? `<div class="refusal">${line.attestation?.error || "The attestation did not verify. The line stays shut."}</div>` : refuseForm()}
    <div class="outcome"></div>
  `;
  const form = card.querySelector("form");
  form?.addEventListener("submit", (event) => onDraw(event, id, passed));
}

function drawForm(id) {
  return `
    <form class="draw" data-mode="draw">
      <label>Draw to Ethereum, USDC
        <input name="amount" type="number" min="1" step="1" value="5000" />
      </label>
      <label>Recipient
        <input name="recipient" value="0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" spellcheck="false" />
      </label>
      <button type="submit">Quote the draw</button>
    </form>`;
}

function refuseForm(id) {
  return `
    <form class="draw" data-mode="refuse">
      <button type="submit">Request $10,000 anyway</button>
    </form>`;
}

async function onDraw(event, id, passed) {
  event.preventDefault();
  const form = event.currentTarget;
  const outcome = form.parentElement.querySelector(".outcome");
  const mode = form.dataset.mode;
  const amountUsd = mode === "refuse" ? 10000 : Number(form.amount.value);
  const recipient = mode === "refuse" ? "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" : form.recipient.value.trim();
  outcome.innerHTML = "<p>Asking the vault…</p>";
  try {
    const response = await fetch("/api/draw", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId: id, amountUsd, recipient }),
    });
    const body = await response.json();
    if (!response.ok) {
      outcome.innerHTML = `<div class="refusal"><b>Refused.</b> ${body.error}</div>`;
      return;
    }
    const quote = body.line.draws.at(-1).intents;
    outcome.innerHTML = `<div class="quote"><b>Dry quote.</b> ${money(amountUsd)} of USDC on NEAR Intents would arrive as ${Number(quote.amountOut).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC on Ethereum in about ${quote.timeEstimateSeconds}s. Nothing was sent.</div><button type="button" data-repay class="ghost">Record a repayment</button>`;
    outcome.querySelector("[data-repay]").addEventListener("click", () => repay(id, amountUsd, recipient, outcome));
    await loadLedger();
  } catch (error) {
    outcome.innerHTML = `<div class="refusal">${error.message}</div>`;
  }
}

function renderPacket(company) {
  const body = sheets
    .map(
      ([title, rows]) => `
      <div class="sheet">
        <h3>${title}</h3>
        ${rows.map(([label, size]) => `<div class="row"><span>${label}</span><i class="bar ${size}"></i></div>`).join("")}
      </div>`
    )
    .join("");
  return `
    <article class="packet" data-company="${company.companyId}">
      <header>
        <div>
          <h2>${company.alias}</h2>
          <p class="trade">${company.trade}</p>
        </div>
        <div class="stamp-slot"></div>
      </header>
      ${body}
      <div class="result"><p class="reasons">Not scored yet. The figures are not in this page.</p></div>
    </article>`;
}

async function repay(id, amountUsd, recipient, outcome) {
  outcome.querySelector("[data-repay]").disabled = true;
  try {
    const response = await fetch("/api/repay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId: id, amountUsd, recipient }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Repayment failed");
    const quote = body.line.repayments.at(-1)?.intents;
    const back = quote?.amountOut
      ? ` A dry quote would send ${Number(quote.amountOut).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC back to NEAR.`
      : "";
    outcome.insertAdjacentHTML(
      "beforeend",
      `<div class="quote"><b>Repaid ${money(amountUsd)}.</b> Outstanding is now ${money(body.line.outstandingUsd)}.${back}</div>`
    );
    await loadLedger();
  } catch (error) {
    outcome.insertAdjacentHTML("beforeend", `<div class="refusal">${error.message}</div>`);
  }
}

async function loadLedger() {
  const { lines } = await api("/api/ledger");
  if (!lines.length) {
    ledgerEl.innerHTML = "<p>No line has been opened.</p>";
    return;
  }
  const serialized = JSON.stringify(lines);
  if (serialized.includes("revenue_t12m") || serialized.includes("ratios")) {
    ledgerEl.innerHTML = "<p class='refusal'>The public record contains books. That is a bug.</p>";
    return;
  }
  ledgerEl.innerHTML = lines.map(renderRecord).join("");
}

function renderRecord(line) {
  const draw = line.draws?.[line.draws.length - 1];
  const rows = [
    ["Company", `${line.alias}`],
    ["Decision", line.decision],
    ["Limit", line.decision === "pass" ? money(line.limitUsd) : "—"],
    ["Outstanding", money(line.outstandingUsd)],
    ["Reason codes", line.reasonCodes.length ? line.reasonCodes.join(", ") : "—"],
    ["Books commitment", line.booksCommitment],
    ["Model", `${line.modelId} · ${line.modelHash}`],
    ["Attestation", line.attestation?.ok ? `${line.attestation.level}, nonce matched` : "not verified"],
    ["Gateway signer", line.attestation?.signingAddress || "—"],
    ["Quote hash", line.attestation?.quoteSha256 || "—"],
    ["Latest draw", draw ? `${money(draw.amountUsd)} to ${draw.recipient}` : "—"],
  ];
  return `<div class="record">${rows.map(([k, v]) => `<div class="k">${k}</div><div class="${k.includes("hash") || k.includes("commitment") || k.includes("Model") || k.includes("signer") || k.includes("draw") ? "hash" : ""}">${v}</div>`).join("")}</div>`;
}

async function loadReplay() {
  const rows = await api("/api/replay");
  replayEl.innerHTML = `<table>
    <thead><tr><th>Company</th><th>Decision</th><th>Limit</th><th>Reason codes</th></tr></thead>
    <tbody>
      ${rows
        .map(
          (row) => `<tr>
            <td data-label="Company">${row.alias}<br><span class="k">${row.trade}</span></td>
            <td data-label="Decision" class="${row.decision === "pass" ? "pass-word" : "fail-word"}">${row.decision}</td>
            <td data-label="Limit">${row.decision === "pass" ? money(row.limitUsd) : "—"}</td>
            <td data-label="Reason codes">${row.reasonCodes.join(", ") || "—"}</td>
          </tr>`
        )
        .join("")}
    </tbody>
  </table>`;
}

async function loadMarket() {
  try {
    const { market, error } = await api("/api/markets");
    if (!market) {
      marketEl.textContent = `Rhea USDC is unread: ${error}`;
      return;
    }
    marketEl.innerHTML = `Rhea USDC on <b>contract.main.burrow.near</b> · borrow ${(market.borrowApr * 100).toFixed(2)}% · supply ${(market.supplyApr * 100).toFixed(2)}% · ${money(market.availableUsd)} available of ${money(market.suppliedUsd)} supplied. A Cloakline draw is priced at that borrow rate and quoted out through NEAR Intents.`;
  } catch (error) {
    marketEl.textContent = error.message;
  }
}

async function reset() {
  memory.clear();
  await api("/api/reset", { method: "POST", body: {} });
  const companies = await api("/api/companies");
  packets.innerHTML = featured
    .map((id) => companies.find((company) => company.companyId === id))
    .map(renderPacket)
    .join("");
  await loadLedger();
  status("Public record cleared.");
}

function status(text) {
  statusEl.textContent = text;
}

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function money(amount) {
  return Number(amount || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function short(value) {
  if (!value) return "—";
  if (value.length < 18) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}
