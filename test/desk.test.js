import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../src/server.js";
import { score } from "../src/model.js";
import { readFileSync } from "node:fs";
import { dirname, join as pathJoin } from "node:path";
import { fileURLToPath } from "node:url";

const companies = JSON.parse(
  readFileSync(pathJoin(dirname(fileURLToPath(import.meta.url)), "../data/companies.json"), "utf8")
);
const harbor = companies.find((company) => company.company_id === "harbor");
const lantern = companies.find((company) => company.company_id === "red-lantern");

test("harbor passes with a $27,200 line and red lantern is declined", () => {
  const passed = score(harbor);
  const declined = score(lantern);
  assert.equal(passed.decision, "pass");
  assert.equal(passed.limitUsd, 27200);
  assert.equal(passed.modelHash, "18690f237feb00452edff054c901e7a3341aa8fe5bb191c396fff34614d05ed6");
  assert.deepEqual(passed.reasonCodes, []);
  assert.equal(declined.decision, "decline");
  assert.equal(declined.limitUsd, 0);
  assert.deepEqual(declined.reasonCodes, ["RUNWAY", "TREND", "CONCENTRATION", "NSF", "PAYABLES"]);
});

test("the desk opens a line, quotes a draw, and refuses the other company", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cloakline-"));
  const ledgerPath = join(dir, "ledger.json");
  const attest = async () => ({
    ok: true,
    level: "gateway-freshness",
    nonce: "abc",
    requestNonce: "abc",
    nonceMatch: true,
    signingAddress: "0x1111111111111111111111111111111111111111",
    signingAlgo: "ecdsa",
    quoteSha256: "deadbeef",
    checkedAt: "2026-11-09T00:00:00.000Z",
    checks: [],
    error: null,
  });
  const { server } = createApp({
    ledgerPath,
    attest,
    markets: {
      rheaUsdc: async () => ({ borrowApr: 0.16 }),
      quoteDraw: async () => ({
        dry: true,
        amountIn: "5.0",
        amountOut: "4.699412",
        amountOutUsd: "4.6966",
        timeEstimateSeconds: 17,
      }),
      quoteRepay: async () => ({ dry: true, amountOut: "4.9" }),
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const listed = await get(base, "/api/companies");
    assert.equal(JSON.stringify(listed).includes("revenue_t12m"), false);

    const opened = await post(base, "/api/score", { companyId: "harbor" });
    assert.equal(opened.status, 200);
    assert.equal(opened.body.line.decision, "pass");
    assert.equal(opened.body.line.limitUsd, 27200);
    assert.equal(opened.body.line.attestation.nonceMatch, true);
    assert.equal(Object.hasOwn(opened.body.line, "ratios"), false);

    const declined = await post(base, "/api/score", { companyId: "red-lantern" });
    assert.equal(declined.body.line.decision, "decline");

    const refused = await post(base, "/api/draw", {
      companyId: "red-lantern",
      amountUsd: 10000,
      recipient: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, "declined");

    const quoted = await post(base, "/api/draw", {
      companyId: "harbor",
      amountUsd: 5000,
      recipient: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    });
    assert.equal(quoted.status, 200);
    assert.equal(quoted.body.line.outstandingUsd, 5000);
    assert.equal(quoted.body.line.draws[0].intents.amountOut, "4.699412");
    assert.equal(quoted.body.line.draws[0].intents.dry, true);

    const over = await post(base, "/api/draw", {
      companyId: "harbor",
      amountUsd: 23000,
      recipient: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    });
    assert.equal(over.status, 403);
    assert.equal(over.body.code, "limit");

    const ledger = await get(base, "/api/ledger");
    const serialized = JSON.stringify(ledger);
    for (const secret of ["revenue_t12m", "revenue_t3m", "monthly_operating_expense", "payables_due_30d", "ratios"]) {
      assert.equal(serialized.includes(secret), false, secret);
    }
    const onDisk = await readFile(ledgerPath, "utf8");
    assert.equal(onDisk.includes("revenue_t12m"), false);
    assert.equal(onDisk.includes("1640000"), false);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

async function get(base, path) {
  const response = await fetch(base + path);
  return response.json();
}

async function post(base, path, body) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
