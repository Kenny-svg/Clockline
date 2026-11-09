import { commitment } from "./canonical.js";

export const MODEL_ID = "cloakline-score-1";

// Every threshold is part of the published model. Change one and the model hash changes.
export const POLICY = {
  id: MODEL_ID,
  minRevenueT12m: 100_000,
  minRunwayHundredths: 200,
  minTrendBps: 7_500,
  minDscrHundredths: 125,
  maxConcentrationBps: 4_500,
  maxNsf: 1,
  cashAdvanceBps: 4_000,
  roundTo: 100,
  minLimit: 1_000,
};

export const MODEL_HASH = commitment(POLICY);

const FIELDS = [
  "revenue_t12m",
  "revenue_t3m",
  "cash",
  "monthly_operating_expense",
  "monthly_debt_service",
  "payables_due_30d",
  "nsf_count_90d",
  "customer_concentration_bps",
];

export function booksForCommitment(books) {
  const out = { company_id: books.company_id };
  for (const field of FIELDS) out[field] = books[field];
  return out;
}

export function assertBooks(books) {
  if (!books || typeof books !== "object") throw new Error("books must be an object");
  if (!/^[a-z0-9-]{2,40}$/.test(books.company_id || "")) {
    throw new Error("company_id must be a lowercase slug");
  }
  for (const field of FIELDS) {
    const value = books[field];
    if (!Number.isInteger(value) || value < 0 || value > 1_000_000_000_000) {
      throw new Error(`${field} must be an integer from 0 to 1e12`);
    }
  }
  if (books.monthly_operating_expense < 1) {
    throw new Error("monthly_operating_expense must be at least 1");
  }
  if (books.customer_concentration_bps > 10_000) {
    throw new Error("customer_concentration_bps cannot exceed 10000");
  }
}

export function score(books) {
  assertBooks(books);
  const revenueT12m = BigInt(books.revenue_t12m);
  const revenueT3m = BigInt(books.revenue_t3m);
  const cash = BigInt(books.cash);
  const opex = BigInt(books.monthly_operating_expense);
  const debt = BigInt(books.monthly_debt_service);
  const payables = BigInt(books.payables_due_30d);

  const monthlyRevenue = revenueT3m / 3n;
  const runwayHundredths = (cash * 100n) / opex;
  const trendBps = revenueT12m === 0n ? 0n : (revenueT3m * 4n * 10_000n) / revenueT12m;
  const dscrHundredths = debt === 0n ? null : (monthlyRevenue * 100n) / debt;
  const liquidCash = cash > payables ? cash - payables : 0n;
  const fromCash = (liquidCash * BigInt(POLICY.cashAdvanceBps)) / 10_000n;
  const rawLimit = fromCash < monthlyRevenue ? fromCash : monthlyRevenue;
  const rounded = rawLimit - (rawLimit % BigInt(POLICY.roundTo));

  const reasons = [];
  if (revenueT12m < BigInt(POLICY.minRevenueT12m)) reasons.push("SIZE");
  if (runwayHundredths < BigInt(POLICY.minRunwayHundredths)) reasons.push("RUNWAY");
  if (trendBps < BigInt(POLICY.minTrendBps)) reasons.push("TREND");
  if (dscrHundredths !== null && dscrHundredths < BigInt(POLICY.minDscrHundredths)) reasons.push("DSCR");
  if (books.customer_concentration_bps > POLICY.maxConcentrationBps) reasons.push("CONCENTRATION");
  if (books.nsf_count_90d > POLICY.maxNsf) reasons.push("NSF");
  if (payables > cash) reasons.push("PAYABLES");

  let limit = Number(rounded);
  if (reasons.length === 0 && limit < POLICY.minLimit) reasons.push("LIMIT");
  if (reasons.length > 0) limit = 0;

  return {
    modelId: MODEL_ID,
    modelHash: MODEL_HASH,
    decision: reasons.length === 0 ? "pass" : "decline",
    limitUsd: limit,
    reasonCodes: reasons,
    ratios: {
      runwayMonths: hundredths(runwayHundredths),
      trend: bps(trendBps),
      dscr: dscrHundredths === null ? null : hundredths(dscrHundredths),
      concentration: books.customer_concentration_bps / 10_000,
      liquidCashUsd: Number(liquidCash),
      monthlyRevenueUsd: Number(monthlyRevenue),
    },
  };
}

function hundredths(value) {
  return Number(value) / 100;
}

function bps(value) {
  return Number(value) / 10_000;
}
