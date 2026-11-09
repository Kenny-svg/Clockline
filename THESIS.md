# Cloakline score-1

This is the model behind the desk, written so it can be re-run without the server and without a network.

## Question

Can a lender publish a credit limit on a public chain without publishing the revenue, cash, payables, or customer concentration that produced it?

The desk’s answer is a commitment. `SHA-256` of the canonical books is stored. The books are not. Anyone with the books can recompute the commitment and the decision. Anyone without the books gets the decision, the limit, the reason codes, and the model hash.

## How to re-run

```sh
npm run replay
```

That reads `data/companies.json` and `src/model.js` and prints one row per company. Expected rows:

| Company | Decision | Limit | Reason codes |
| --- | --- | --- | --- |
| Harbor & Co | pass | 27200 | — |
| Red Lantern Trading | decline | 0 | RUNWAY, TREND, CONCENTRATION, NSF, PAYABLES |
| Kiln Studio | pass | 12800 | — |
| Paper Mill Supply | decline | 0 | RUNWAY |
| North Glass | pass | 24000 | — |
| Field Note | decline | 0 | SIZE |
| Whale Client Co | decline | 0 | CONCENTRATION |
| Late Payer Goods | decline | 0 | NSF |

`npm test` locks Harbor at $27,200 and Red Lantern to those five reason codes. If you change a threshold, both the hash on the public record and these rows change. That is the point.

## Definitions

All inputs are whole dollars, except `customer_concentration_bps` (10,000 = 100%) and `nsf_count_90d`.

- Runway, in hundredths of a month: `cash * 100 / monthly_operating_expense`
- Trend, in basis points: `revenue_t3m * 4 * 10000 / revenue_t12m`
- Monthly revenue: `revenue_t3m / 3`
- Debt service coverage, in hundredths: `monthly_revenue * 100 / monthly_debt_service`, omitted when debt service is 0
- Liquid cash: `max(cash - payables_due_30d, 0)`
- Limit: the lesser of `40%` of liquid cash and one month of revenue, rounded down to $100

Division is integer division toward zero. There are no floats in the decision.

## What this is not

It is not a trained default model and it is not a claim about NEAR the asset. The eight companies are synthetic. The Rhea borrow rate on the desk is a live price for the line, read from Rhea’s lending API. It does not enter the pass or fail decision. A company that passes still has to fit inside its own limit, and the draw quote is a separate Intents price for moving USDC to Ethereum.

The attestation next to a decision proves the gateway echoed a nonce minted here and returned an Intel quote. It does not, in this build, prove the quote against Intel DCAP, and it does not prove that a language model chose the limit. The limit comes from the formula above.
