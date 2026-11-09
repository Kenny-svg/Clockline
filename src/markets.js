const RHEA_ASSETS = "https://lendingsdk.rhea.finance/get_assets_paged_detailed";
const QUOTE_URL = "https://1click.chaindefuser.com/v0/quote";

const NEAR_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const ETH_USDC = "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near";
const USDC_TOKEN = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDC_DECIMALS = 6;

export async function rheaUsdc({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(RHEA_ASSETS, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Rhea lending returned ${response.status}`);
  const body = await response.json();
  const rows = body.data || [];
  const asset = rows.find((row) => row.token_id === USDC_TOKEN);
  if (!asset) throw new Error("Rhea did not return native USDC");

  const scale = USDC_DECIMALS + Number(asset.config?.extra_decimals ?? 0);
  const supplied = units(asset.supplied?.balance || "0", scale);
  const borrowed = units(asset.borrowed?.balance || "0", scale);
  const available = Number((supplied - borrowed).toFixed(2));

  return {
    protocol: "Rhea lending",
    contract: "contract.main.burrow.near",
    token: "USDC",
    tokenId: USDC_TOKEN,
    borrowApr: Number(asset.borrow_apr),
    supplyApr: Number(asset.supply_apr),
    suppliedUsd: supplied,
    borrowedUsd: borrowed,
    availableUsd: available,
    source: RHEA_ASSETS,
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
