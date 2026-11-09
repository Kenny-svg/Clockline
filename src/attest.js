import { randomBytes, createHash } from "node:crypto";

const ATTESTATION_URL = "https://cloud-api.near.ai/v1/attestation/report";

export function freshNonce() {
  return randomBytes(32).toString("hex");
}

export async function attestGateway({ fetchImpl = fetch, nonce = freshNonce(), model } = {}) {
  const url = new URL(ATTESTATION_URL);
  url.searchParams.set("signing_algo", "ecdsa");
  url.searchParams.set("nonce", nonce);
  if (model) url.searchParams.set("model", model);

  let response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/json" } });
  } catch (error) {
    return failed(nonce, `Could not reach NEAR AI Cloud: ${error.message}`);
  }
  if (!response.ok) {
    return failed(nonce, `NEAR AI Cloud returned ${response.status}`);
  }

  const body = await response.json();
  const gateway = body.gateway_attestation;
  if (!gateway) return failed(nonce, "Response had no gateway_attestation");

  const echoed = String(gateway.request_nonce || "").toLowerCase();
  const nonceMatch = echoed === nonce.toLowerCase();
  const quote = String(gateway.intel_quote || "");
  const quotePresent = quote.length > 0;
  const signingAddress = gateway.signing_address || null;

  return {
    ok: Boolean(nonceMatch && quotePresent && signingAddress),
    level: nonceMatch && quotePresent && signingAddress ? "gateway-freshness" : "failed",
    nonce,
    requestNonce: echoed || null,
    nonceMatch,
    signingAddress,
    signingAlgo: gateway.signing_algo || null,
    quoteSha256: quotePresent ? createHash("sha256").update(quote).digest("hex") : null,
    checkedAt: new Date().toISOString(),
    checks: [
      { id: "nonce-generated", label: "Nonce generated in this process", pass: true },
      { id: "nonce-echo", label: "Gateway echoed that nonce", pass: nonceMatch },
      { id: "quote-present", label: "Intel quote present and hashed", pass: quotePresent },
      {
        id: "dcap",
        label: "Intel DCAP quote verification",
        pass: false,
        note: "Not performed in this build. The quote hash is pinned so a verifier can be added without trusting the HTTP fields.",
      },
    ],
    error: nonceMatch && quotePresent && signingAddress ? null : "Gateway evidence failed a freshness check",
  };
}

function failed(nonce, error) {
  return {
    ok: false,
    level: "failed",
    nonce,
    requestNonce: null,
    nonceMatch: false,
    signingAddress: null,
    signingAlgo: null,
    quoteSha256: null,
    checkedAt: new Date().toISOString(),
    checks: [
      { id: "nonce-generated", label: "Nonce generated in this process", pass: true },
      { id: "nonce-echo", label: "Gateway echoed that nonce", pass: false },
      { id: "quote-present", label: "Intel quote present and hashed", pass: false },
      { id: "dcap", label: "Intel DCAP quote verification", pass: false, note: "Not performed in this build." },
    ],
    error,
  };
}
