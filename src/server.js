import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { attestGateway } from "./attest.js";
import { quoteDraw, quoteRepay, rheaUsdc } from "./markets.js";
import { MODEL_HASH, MODEL_ID, POLICY, score } from "./model.js";
import { assertDrawable, createLedger } from "./vault.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const companies = JSON.parse(readFileSync(join(root, "data/companies.json"), "utf8"));
const publicDir = join(root, "public");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

export function createApp({
  ledgerPath = join(root, "data/ledger.json"),
  attest = attestGateway,
  markets = { rheaUsdc, quoteDraw, quoteRepay },
} = {}) {
  const ledger = createLedger(ledgerPath);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/api/health") {
        return send(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/model") {
        return send(res, 200, { id: MODEL_ID, hash: MODEL_HASH, policy: POLICY });
      }
      if (req.method === "GET" && url.pathname === "/api/companies") {
        return send(res, 200, companies.map(publicCompany));
      }
      if (req.method === "GET" && url.pathname === "/api/replay") {
        return send(
          res,
          200,
          companies.map((company) => {
            const result = score(company);
            return {
              companyId: company.company_id,
              alias: company.alias,
              trade: company.trade,
              decision: result.decision,
              limitUsd: result.limitUsd,
              reasonCodes: result.reasonCodes,
              modelHash: result.modelHash,
            };
          })
        );
      }
      if (req.method === "GET" && url.pathname === "/api/ledger") {
        return send(res, 200, { lines: await ledger.list() });
      }
      if (req.method === "POST" && url.pathname === "/api/reset") {
        return send(res, 200, { lines: await ledger.reset() });
      }
      if (req.method === "GET" && url.pathname === "/api/markets") {
        try {
          return send(res, 200, { market: await markets.rheaUsdc() });
        } catch (error) {
          return send(res, 200, { market: null, error: error.message });
        }
      }
      if (req.method === "POST" && url.pathname === "/api/score") {
        const body = await readBody(req);
        const company = resolveCompany(body);
        const attestation = await attest();
        const { line, privateView } = await ledger.openLine({
          books: company,
          alias: company.alias,
          trade: company.trade,
          attestation,
        });
        return send(res, 200, {
          line,
          privateView: {
            decision: privateView.decision,
            limitUsd: privateView.limitUsd,
            reasonCodes: privateView.reasonCodes,
            ratios: privateView.ratios,
          },
        });
      }
      if (req.method === "POST" && url.pathname === "/api/draw") {
        const body = await readBody(req);
        const amountUsd = Number(body.amountUsd);
        const recipient = String(body.recipient || "");
        const lines = await ledger.list();
        const existing = lines.find((line) => line.companyId === body.companyId);
        if (!existing) return send(res, 404, { error: "Score this company before drawing." });
        try {
          assertDrawable(existing, amountUsd, recipient);
        } catch (error) {
          return send(res, error.status || 400, { error: error.message, code: error.code, reasonCodes: error.reasonCodes });
        }
        let intents = null;
        try {
          intents = await markets.quoteDraw({ amountUsd, recipient });
        } catch (error) {
          return send(res, 502, {
            error: `The line allows this draw. NEAR Intents did not return a quote: ${error.message}`,
          });
        }
        const line = await ledger.draw({ companyId: body.companyId, amountUsd, recipient, intents });
        return send(res, 200, { line });
      }
      if (req.method === "POST" && url.pathname === "/api/repay") {
        const body = await readBody(req);
        const amountUsd = Number(body.amountUsd);
        const recipient = String(body.recipient || "");
        const line = await ledger.repay({ companyId: body.companyId, amountUsd });
        let intents = null;
        let quoteError = null;
        if (/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
          try {
            intents = await markets.quoteRepay({ amountUsd, recipient });
            await ledger.attachQuote({ companyId: body.companyId, quote: intents, kind: "repay" });
          } catch (error) {
            quoteError = error.message;
          }
        }
        const lines = await ledger.list();
        return send(res, 200, {
          line: lines.find((item) => item.companyId === body.companyId) || line,
          quoteError,
        });
      }
      if (req.method === "GET") return serveStatic(url.pathname, res);
      send(res, 404, { error: "Not found" });
    } catch (error) {
      send(res, error.status || 500, { error: error.message });
    }
  });

  return { server, ledger };
}

function publicCompany(company) {
  return {
    companyId: company.company_id,
    alias: company.alias,
    trade: company.trade,
    sheets: ["Revenue", "Cash and payables", "Debt service"],
  };
}

function resolveCompany(body) {
  if (body.companyId) {
    const found = companies.find((company) => company.company_id === body.companyId);
    if (!found) throw Object.assign(new Error("Unknown sample company."), { status: 404 });
    return found;
  }
    if (body.books) {
    try {
      score(body.books);
    } catch (error) {
      throw Object.assign(error, { status: 400 });
    }
    return {
      ...body.books,
      alias: body.alias || body.books.company_id,
      trade: body.trade || "Uploaded books",
    };
  }
  throw Object.assign(new Error("Send a companyId or books."), { status: 400 });
}

function serveStatic(pathname, res) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^[/\\]+/, "");
  if (relative.includes("..")) return send(res, 400, { error: "Bad path" });
  const file = join(publicDir, relative);
  if (!file.startsWith(publicDir)) return send(res, 400, { error: "Bad path" });
  try {
    const body = readFileSync(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    send(res, 404, { error: "Not found" });
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error("Body must be JSON."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.PORT || 4173);
  const { server } = createApp();
  server.listen(port, () => {
    console.log(`Cloakline desk  http://127.0.0.1:${port}`);
  });
}
