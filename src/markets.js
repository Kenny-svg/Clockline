const NEAR_RPC = "https://rpc.mainnet.near.org";
const RHEA_CONTRACT = "contract.main.burrow.near";
const QUOTE_URL = "https://1click.chaindefuser.com/v0/quote";

const NEAR_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const ETH_USDC = "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near";
const USDC_TOKEN = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDC_DECIMALS = 6;

export async function rheaUsdc({ fetchImpl = fetch } = {}) {
  const args = Buffer.from(JSON.stringify({ token_id: USDC_TOKEN })).toString("base64");
  const response = await fetchImpl(NEAR_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "cloakline",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: RHEA_CONTRACT,
        method_name: "get_asset",
        args_base64: args,
      },
    }),
  });
  if (!response.ok) throw new Error(`NEAR RPC returned ${response.status}`);
  const body = await response.json();
  if (body.error) {
    const message = body.error.data || body.error.message || "NEAR RPC rejected the Rhea view";
    throw new Error(typeof message === "string" ? message : "NEAR RPC rejected the Rhea view");
  }
  const bytes = body.result?.result;
  if (!Array.isArray(bytes) || bytes.length === 0) throw new Error("Rhea did not return native USDC");
  const asset = JSON.parse(new TextDecoder().decode(Uint8Array.from(bytes)));
  if (!asset || asset.token_id !== USDC_TOKEN) throw new Error("Rhea did not return native USDC");

  const scale = USDC_DECIMALS + Number(asset.config?.extra_decimals ?? 0);
  const supplied = units(asset.supplied?.balance || "0", scale);
  const borrowed = units(asset.borrowed?.balance || "0", scale);
  const available = Number((supplied - borrowed).toFixed(2));

  return {
    protocol: "Rhea lending",
    contract: RHEA_CONTRACT,
    token: "USDC",
    tokenId: USDC_TOKEN,
    borrowApr: Number(asset.borrow_apr),
    supplyApr: Number(asset.supply_apr),
    suppliedUsd: supplied,
    borrowedUsd: borrowed,
    availableUsd: available,
    source: NEAR_RPC,
    readAt: new Date().toISOString(),
  };
}

export async function quoteDraw({ amountUsd, recipient, fetchImpl = fetch }) {
  return quote(
    {
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: NEAR_USDC,
      depositType: "INTENTS",
      destinationAsset: ETH_USDC,
      amount: String(amountUsd * 1_000_000),
      refundTo: "intents.near",
      refundType: "INTENTS",
      recipient,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    },
    fetchImpl
  );
}

export async function quoteRepay({ amountUsd, recipient, fetchImpl = fetch }) {
  return quote(
    {
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: ETH_USDC,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: NEAR_USDC,
      amount: String(amountUsd * 1_000_000),
      refundTo: recipient,
      refundType: "ORIGIN_CHAIN",
      recipient: "intents.near",
      recipientType: "INTENTS",
      deadline: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    },
    fetchImpl
  );
}

async function quote(body, fetchImpl) {
  const response = await fetchImpl(QUOTE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || `1Click returned ${response.status}`);
  }
  const q = payload.quote || {};
  return {
    dry: true,
    amountIn: q.amountInFormatted || null,
    amountOut: q.amountOutFormatted || null,
    amountOutUsd: q.amountOutUsd || null,
    timeEstimateSeconds: q.timeEstimate ?? null,
    withdrawFee: q.withdrawFee || null,
    origin: body.originAsset,
    destination: body.destinationAsset,
  };
}

function units(raw, decimals) {
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  const digits = fraction.toString().padStart(decimals, "0").slice(0, 2);
  return Number(`${whole}.${digits}`);
}
