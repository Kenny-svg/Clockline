import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { score } from "./model.js";

const companies = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../data/companies.json"), "utf8")
);

const rows = companies.map((company) => {
  const result = score(company);
  return {
    alias: company.alias,
    decision: result.decision,
    limit: result.limitUsd,
    reasons: result.reasonCodes.join(", ") || "—",
  };
});

const aliasWidth = Math.max(...rows.map((row) => row.alias.length));
console.log("Cloakline score-1 replay. Inputs are data/companies.json. No network.\n");
console.log(
  `${"Company".padEnd(aliasWidth)}  Decision  Limit      Reasons`
);
for (const row of rows) {
  console.log(
    `${row.alias.padEnd(aliasWidth)}  ${row.decision.padEnd(8)}  ${String(row.limit).padStart(7)}    ${row.reasons}`
  );
}
