
function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}
function parseNumber(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function arrayify(value) { return !value ? [] : Array.isArray(value) ? value : [value]; }
function clamp(num, min, max) { return Math.max(min, Math.min(max, num)); }

async function tradierFetch(path, token, baseUrl) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
  });
  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (_) {
    throw Object.assign(new Error("Options API returned a non-JSON response"), { details: rawText });
  }
  if (!response.ok) throw new Error(data?.fault?.faultstring || data?.errors || `Tradier request failed for ${path}`);
  return data;
}

function normalizeContract(raw) {
  const bid = parseNumber(raw.bid);
  const ask = parseNumber(raw.ask);
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : Math.max(bid, ask, 0);
  const spreadPct = mid > 0 ? ((ask - bid) / mid) * 100 : 999;
  return {
    symbol: raw.symbol,
    expiration: raw.expiration_date,
    strike: parseNumber(raw.strike),
    bid,
    ask,
    spreadPct: Number(spreadPct.toFixed(2)),
    volume: parseNumber(raw.volume, 0),
    openInterest: parseNumber(raw.open_interest, 0),
    delta: parseNumber(raw.greeks?.delta, 0),
    iv: parseNumber(raw.greeks?.mid_iv, parseNumber(raw.greeks?.smv_vol, 0)),
    contractScore: 0,
  };
}

function contractScore(contract, side) {
  const spreadScore = clamp(100 - contract.spreadPct * 8, 0, 100);
  const volumeScore = clamp(Math.log10((contract.volume || 0) + 1) * 28, 0, 100);
  const oiScore = clamp(Math.log10((contract.openInterest || 0) + 1) * 28, 0, 100);
  const targetDelta = side === "calls" ? 0.45 : -0.45;
  const deltaDistance = Math.abs(parseNumber(contract.delta, 0) - targetDelta);
  const deltaScore = clamp(100 - deltaDistance * 180, 0, 100);
  return Math.round(spreadScore * 0.35 + volumeScore * 0.25 + oiScore * 0.25 + deltaScore * 0.15);
}

function pickTopContracts(contracts) { return contracts.slice(0, 2); }

module.exports.handler = async function (event) {
  const token = process.env.TRADIER_ACCESS_TOKEN;
  const baseUrl = process.env.TRADIER_BASE_URL || "https://api.tradier.com/v1";
  if (!token) return json(500, { error: "Missing TRADIER_ACCESS_TOKEN in Netlify environment variables." });

  const symbol = (event.queryStringParameters?.symbol || "").trim().toUpperCase();
  const side = (event.queryStringParameters?.side || "calls").toLowerCase() === "puts" ? "puts" : "calls";
  const minVolume = parseNumber(event.queryStringParameters?.minVolume, 100);
  const minOpenInterest = parseNumber(event.queryStringParameters?.minOpenInterest, 250);
  const maxSpreadPct = parseNumber(event.queryStringParameters?.maxSpreadPct, 8);
  const minDeltaAbs = parseNumber(event.queryStringParameters?.minDeltaAbs, 0.25);
  const maxDeltaAbs = parseNumber(event.queryStringParameters?.maxDeltaAbs, 0.65);
  const expirationCount = clamp(parseNumber(event.queryStringParameters?.expirations, 3), 1, 6);

  if (!symbol) return json(400, { error: "Please pass a symbol, like ?symbol=AAPL&side=calls" });

  try {
    const expirationsData = await tradierFetch(`/markets/options/expirations?symbol=${encodeURIComponent(symbol)}&includeAllRoots=true&strikes=false`, token, baseUrl);
    const expirationList = arrayify(expirationsData?.expirations?.date).slice(0, expirationCount);
    if (!expirationList.length) return json(404, { error: `No option expirations found for ${symbol}.` });

    const quotesData = await tradierFetch(`/markets/quotes?symbols=${encodeURIComponent(symbol)}&greeks=false`, token, baseUrl);
    const underlyingQuote = arrayify(quotesData?.quotes?.quote)[0];
    const underlyingPrice = parseNumber(underlyingQuote?.last || underlyingQuote?.close || underlyingQuote?.bid || underlyingQuote?.ask, 0);

    const chainResults = await Promise.all(
      expirationList.map((exp) =>
        tradierFetch(`/markets/options/chains?symbol=${encodeURIComponent(symbol)}&expiration=${encodeURIComponent(exp)}&greeks=true`, token, baseUrl)
      )
    );

    const typeWanted = side === "puts" ? "put" : "call";
    const contracts = chainResults
      .flatMap((chain) => arrayify(chain?.options?.option))
      .filter((raw) => raw.option_type === typeWanted)
      .map(normalizeContract)
      .filter((c) => {
        const absDelta = Math.abs(c.delta);
        return c.bid > 0 && c.ask >= c.bid && c.volume >= minVolume && c.openInterest >= minOpenInterest && c.spreadPct <= maxSpreadPct && absDelta >= minDeltaAbs && absDelta <= maxDeltaAbs;
      })
      .map((c) => ({ ...c, contractScore: contractScore(c, side) }))
      .sort((a, b) => b.contractScore - a.contractScore)
      .slice(0, 30);

    return json(200, {
      symbol,
      side,
      underlyingPrice,
      expirationsUsed: expirationList,
      contracts,
      bestContracts: pickTopContracts(contracts),
    });
  } catch (error) {
    return json(500, { error: error.message || "Failed to load Tradier option-chain data." });
  }
}
