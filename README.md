# Cloakline

A credit desk that opens a USDC line against a company's books without putting the books on a public record.

A founder drops three statements: revenue, cash and payables, and debt service. Cloakline runs the published formula in `src/model.js`, asks NEAR AI Cloud for a fresh gateway attestation, and writes only the commitment, the decision, the limit, and the attestation. Harbor & Co passes. Red Lantern Trading does not. A pass can be quoted from NEAR USDC to Ethereum USDC through NEAR Intents. A decline reverts with reason codes. Rhea’s USDC market is the price of the line.

Tracks: `privacy`, `defi`, `thesis`.

The synthetic books live in `data/companies.json` so anyone can re-run the model. They are the dataset, not the public record. The ledger file and `GET /api/ledger` omit them.

## Try it

Node 20 or newer. No API key.

```sh
npm test
npm run replay
npm start
```

Open http://127.0.0.1:4173

1. `npm test` exits 0. The first test prints Harbor as a pass at **$27,200** and Red Lantern as a decline with `RUNWAY, TREND, CONCENTRATION, NSF, PAYABLES`. The second test refuses a draw on the decline, quotes a $5,000 draw on the pass, and checks that the ledger file does not contain `revenue_t12m` or `1640000`.
2. `npm run replay` prints eight companies and the same two results, with no network.
3. `npm start`, then open the desk. The packets show labels and black bars, not figures.
4. Click **Score both companies**. Harbor shows **Pass** and **$27,200**. Red Lantern shows **Decline** and its reason codes. Each card lists the gateway checks. “Nonce echoed” and “Intel quote present” are checked. “Intel DCAP quote verification” stays **Not claimed**. The public record underneath shows a books commitment, a model hash, a signer, and a quote hash. It does not show revenue, cash, or payables.
5. On Harbor, leave the sample Ethereum address and click **Quote the draw**. A green box shows a dry NEAR Intents quote: $5,000 of USDC in, an amount out on Ethereum, and a time estimate. Nothing is sent. Click **Record a repayment**. Outstanding returns to $0, with a dry quote for the USDC coming back to NEAR.
6. On Red Lantern, click **Request $10,000 anyway**. The box says **Refused** and names the decline. The outstanding balance stays 0.
7. The Rhea strip at the top shows a live USDC borrow rate from a `get_asset` view on `contract.main.burrow.near`. The line is priced at that rate. The desk does not borrow from Rhea in this build. It reads the market and settles the draw quote through Intents.

Scoring needs a network call to `https://cloud-api.near.ai/v1/attestation/report`. No API key. The quote needs `https://1click.chaindefuser.com`. If either call fails, the desk says so and does not invent a signature or a fill.

## What is attested

The gateway report is requested with a 32-byte nonce generated in this process. Cloakline checks that the report echoes the nonce, that an Intel quote is present, and stores the SHA-256 of that quote. It does **not** run Intel DCAP verification. A full verifier is the one in [nearai-cloud-verifier](https://github.com/nearai/nearai-cloud-verifier). The card says this, so a pass is not a claim that the quote was checked against Intel’s root.

The formula itself runs in this process, from source you can read. A pass is not a claim that a model inside a TEE invented the limit.

## The formula

`cloakline-score-1`. Integer arithmetic. Thresholds live in `POLICY` in `src/model.js`. The model hash is `18690f237feb00452edff054c901e7a3341aa8fe5bb191c396fff34614d05ed6`, the SHA-256 of that object. Editing a threshold changes the hash on the public record.

A company needs all of these:

- trailing twelve-month revenue of at least $100,000
- cash covering at least 2.00 months of operating expense
- trailing three-month revenue, annualized, at least 0.75 of the trailing year
- debt service coverage of at least 1.25, skipped when debt service is zero
- largest customer at most 45% of revenue
- at most one returned payment in ninety days
- cash at least equal to payables due in thirty days

The limit is the lesser of 40% of cash after those payables, and one month of trailing revenue, rounded down to $100. Below $1,000 the desk declines. Reason codes are the only explanation written down. The inputs are not.

## Public record

`data/ledger.json` after a score. Fields: alias, decision, limit, outstanding, reason codes, books commitment, model id, model hash, attestation nonce, signer, quote hash, draws. Draws store the dry Intents quote.

Methods, which are the contract surface:

- `openLine` writes the commitment and the decision
- `draw` moves outstanding only after a pass, a fresh attestation, a whole-dollar amount inside the remaining limit, and an Ethereum recipient
- `repay` reduces outstanding and cannot repay more than is drawn

## NEAR

- **NEAR AI Cloud** gateway attestation, nonce-bound, no key: https://docs.near.ai/cloud/verification/cloud-api/gateway-attestation
- **Rhea** lending read of native USDC on `contract.main.burrow.near` via a NEAR RPC `get_asset` view. Borrow APR is the price shown on the desk. Balances use the token’s 6 decimals plus Rhea’s `extra_decimals`.
- **NEAR Intents** `POST https://1click.chaindefuser.com/v0/quote` with `dry: true`. Origin `nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` (USDC on NEAR), destination `nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near` (USDC on Ethereum), `depositType: INTENTS`. There is no Intents testnet. This path does not deposit.

## License

MIT. See [LICENSE](LICENSE).
