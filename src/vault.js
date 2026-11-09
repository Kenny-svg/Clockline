import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { commitment } from "./canonical.js";
import { booksForCommitment, score } from "./model.js";

const BOOK_KEYS = [
  "revenue_t12m",
  "revenue_t3m",
  "cash",
  "monthly_operating_expense",
  "monthly_debt_service",
  "payables_due_30d",
  "nsf_count_90d",
  "customer_concentration_bps",
  "ratios",
  "runwayMonths",
  "monthlyRevenueUsd",
  "liquidCashUsd",
];

export function createLedger(file) {
  let queue = Promise.resolve();

  function update(fn) {
    const run = queue.then(fn, fn);
    queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function read() {
    try {
      const parsed = JSON.parse(await readFile(file, "utf8"));
      return Array.isArray(parsed.lines) ? parsed : { lines: [] };
    } catch (error) {
      if (error.code === "ENOENT") return { lines: [] };
      throw error;
    }
  }

  async function write(state) {
    await mkdir(dirname(file), { recursive: true });
    const safe = { lines: state.lines.map(publicLine) };
    await writeFile(file, `${JSON.stringify(safe, null, 2)}\n`);
    return safe;
  }

  return {
    file,
    list() {
      return update(async () => (await read()).lines.map(publicLine));
    },
    reset() {
      return update(async () => {
        await write({ lines: [] });
        return [];
      });
    },
    openLine({ books, attestation, alias, trade }) {
      return update(async () => {
        const decision = score(books);
        const line = publicLine({
          companyId: books.company_id,
          alias,
          trade,
          booksCommitment: commitment(booksForCommitment(books)),
          modelId: decision.modelId,
          modelHash: decision.modelHash,
          decision: decision.decision,
          limitUsd: decision.limitUsd,
          reasonCodes: decision.reasonCodes,
          attestation,
          outstandingUsd: 0,
          draws: [],
          repayments: [],
          openedAt: new Date().toISOString(),
        });
        const state = await read();
        const lines = state.lines.filter((item) => item.companyId !== line.companyId);
        lines.push(line);
        await write({ lines });
        return { line, privateView: decision };
      });
    },
    draw({ companyId, amountUsd, recipient, intents }) {
      return update(async () => {
        const state = await read();
        const line = state.lines.find((item) => item.companyId === companyId);
        if (!line) throw Object.assign(new Error("No public record for this company."), { status: 404 });
        assertDrawable(line, amountUsd, recipient);
        line.draws.push({
          amountUsd,
          recipient,
          destination: "ethereum",
          asset: "USDC",
          status: intents ? "quoted" : "approved",
          quotedAt: new Date().toISOString(),
          intents: intents || null,
        });
        line.outstandingUsd += amountUsd;
        await write(state);
        return publicLine(line);
      });
    },
    attachQuote({ companyId, quote, kind }) {
      return update(async () => {
        const state = await read();
        const line = state.lines.find((item) => item.companyId === companyId);
        if (!line) throw Object.assign(new Error("No public record for this company."), { status: 404 });
        const bucket = kind === "repay" ? line.repayments : line.draws;
        const event = bucket[bucket.length - 1];
        if (!event) throw Object.assign(new Error("No payment to attach a quote to."), { status: 409 });
        event.intents = quote;
        await write(state);
        return publicLine(line);
      });
    },
    repay({ companyId, amountUsd }) {
      return update(async () => {
        const state = await read();
        const line = state.lines.find((item) => item.companyId === companyId);
        if (!line) throw Object.assign(new Error("No public record for this company."), { status: 404 });
        if (!Number.isInteger(amountUsd) || amountUsd <= 0) {
          throw Object.assign(new Error("Repayment must be a positive whole number of dollars."), { status: 400 });
        }
        if (amountUsd > line.outstandingUsd) {
          throw Object.assign(new Error("Repayment is larger than the outstanding draw."), { status: 400 });
        }
        line.repayments.push({
          amountUsd,
          status: "recorded",
          recordedAt: new Date().toISOString(),
        });
        line.outstandingUsd -= amountUsd;
        await write(state);
        return publicLine(line);
      });
    },
  };
}

export function assertDrawable(line, amountUsd, recipient) {
  if (line.decision !== "pass") {
    throw Object.assign(new Error("The vault refused the draw. The attestation is a decline."), {
      status: 403,
      code: "declined",
      reasonCodes: line.reasonCodes,
    });
  }
  if (!line.attestation?.ok) {
    throw Object.assign(new Error("The vault refused the draw. There is no fresh gateway attestation."), {
      status: 403,
      code: "attestation",
    });
  }
  if (!Number.isInteger(amountUsd) || amountUsd <= 0) {
    throw Object.assign(new Error("Draw amount must be a positive whole number of dollars."), { status: 400 });
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(recipient || "")) {
    throw Object.assign(new Error("Recipient must be an Ethereum address."), { status: 400 });
  }
  if (line.outstandingUsd + amountUsd > line.limitUsd) {
    throw Object.assign(
      new Error(`The vault refused the draw. ${usd(amountUsd)} would put the line above ${usd(line.limitUsd)}.`),
      { status: 403, code: "limit", limitUsd: line.limitUsd, outstandingUsd: line.outstandingUsd }
    );
  }
}

export function publicLine(line) {
  const safe = {
    companyId: line.companyId,
    alias: line.alias,
    trade: line.trade,
    booksCommitment: line.booksCommitment,
    modelId: line.modelId,
    modelHash: line.modelHash,
    decision: line.decision,
    limitUsd: line.limitUsd,
    reasonCodes: line.reasonCodes,
    attestation: line.attestation,
    outstandingUsd: line.outstandingUsd,
    draws: line.draws,
    repayments: line.repayments,
    openedAt: line.openedAt,
  };
  const blob = JSON.stringify(safe);
  for (const key of BOOK_KEYS) {
    if (blob.includes(`"${key}"`)) {
      throw new Error(`Public record leaked ${key}`);
    }
  }
  return safe;
}

function usd(amount) {
  return `$${amount.toLocaleString("en-US")}`;
}
