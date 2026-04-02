// v2

const POLYGON_BASE = "https://api.polygon.io";

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

function parseSymbols(raw) {
  return [...new Set((raw || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 25);
}
function average(values) { return values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : 0; }
function sma(values, period) { return values.length < period ? null : average(values.slice(0, period)); }
function clamp(num, min, max) { return Math.max(min, Math.min(max, num)); }

function rsi(closes, period = 14) {
  if (closes.length <= period) return null;
  let gains = 0, losses = 0;
  for (let i = 0; i < period; i++) {
    const delta = closes[i] - closes[i + 1];
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period; i < closes.length - 1; i++) {
    const delta = closes[i] - closes[i + 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function getStructureBias(values) {
  const recent = values.slice(0, 5);
  const prior = values.slice(5, 10);
  const recentHigh = Math.max(...recent.map((v) => v.high));
  const recentLow = Math.min(...recent.map((v) => v.low));
  const priorHigh = Math.max(...prior.map((v) => v.high));
  const priorLow = Math.min(...prior.map((v) => v.low));
  const close = values[0].close;

  if (recentHigh > priorHigh && recentLow > priorLow && close > priorHigh) return { bias: "Bullish Structure", score: 90 };
  if (recentHigh < priorHigh && recentLow < priorLow && close < priorLow) return { bias: "Bearish Structure", score: 90 };
  if (recentHigh > priorHigh && recentLow >= priorLow) return { bias: "Bullish Structure", score: 74 };
  if (recentHigh < priorHigh && recentLow <= priorLow) return { bias: "Bearish Structure", score: 74 };
  return { bias: "Mixed Structure", score: 45 };
}

function getLocationTag(distanceToSupport, distanceToResistance) {
  if (distanceToSupport <= 2.5 && distanceToResistance >= 3.5) return { tag: "Near Support", score: 88 };
  if (distanceToResistance <= 2.5 && distanceToSupport >= 3.5) return { tag: "Near Resistance", score: 88 };
  if (distanceToSupport > 2.5 && distanceToResistance > 2.5) return { tag: "Mid Range", score: 45 };
  return { tag: "Tight Range", score: 35 };
}

function getLiquidityContext(price, pdh, pdl) {
  const distPDH = ((pdh - price) / price) * 100;
  const distPDL = ((price - pdl) / price) * 100;

  if (price > pdh) return { tag: "Above PDH", score: 82 };
  if (price < pdl) return { tag: "Below PDL", score: 82 };
  if (distPDH >= 0 && distPDH <= 1.0) return { tag: "Near PDH", score: 90 };
  if (distPDL >= 0 && distPDL <= 1.0) return { tag: "Near PDL", score: 90 };
  return { tag: "Inside Prior Day Range", score: 55 };
}

function getDisplacement(values) {
  const currentRange = values[0].high - values[0].low;
  const avgRange5 = average(values.slice(1, 6).map((v) => v.high - v.low)) || 1;
  const ratio = currentRange / avgRange5;

  if (ratio >= 1.6) return { label: "Strong", score: 90 };
  if (ratio >= 1.15) return { label: "Moderate", score: 68 };
  return { label: "Weak", score: 42 };
}

function getSessionLabelEST() {
  const now = new Date();
  const estText = now.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const [h, m] = estText.split(":").map(Number);
  const minutes = h * 60 + m;

  if (minutes >= 19 * 60 && minutes < 24 * 60) return { label: "Asia Range", score: 62 };
  if (minutes >= 0 && minutes < 3 * 60) return { label: "Late Asia", score: 55 };
  if (minutes >= 3 * 60 && minutes < 8 * 60) return { label: "Pre-London", score: 88 };
  if (minutes >= 8 * 60 && minutes < 11 * 60) return { label: "London Expansion", score: 92 };
  if (minutes >= 11 * 60 && minutes < 14 * 60) return { label: "Post-Move", score: 55 };
  return { label: "Neutral Session", score: 50 };
}

function getRoom(distanceToSupport, distanceToResistance, directionalBias) {
  if (directionalBias === "Calls") {
    if (distanceToResistance >= 4) return { tag: "Good Room", score: 85 };
    if (distanceToResistance >= 2) return { tag: "Limited Room", score: 58 };
    return { tag: "Poor Room", score: 25 };
  }
  if (directionalBias === "Puts") {
    if (distanceToSupport >= 4) return { tag: "Good Room", score: 85 };
    if (distanceToSupport >= 2) return { tag: "Limited Room", score: 58 };
    return { tag: "Poor Room", score: 25 };
  }
  return { tag: "Range", score: 35 };
}

function getSetupType(structureBias, locationTag, bias, liquidityContext) {
  if (bias === "Calls" && (locationTag === "Near Support" || liquidityContext === "Near PDL")) return "Reversal (Support)";
  if (bias === "Puts" && (locationTag === "Near Resistance" || liquidityContext === "Near PDH")) return "Reversal (Resistance)";
  if (bias === "Calls" && (structureBias === "Bullish Structure" || liquidityContext === "Above PDH")) return "Continuation (Bullish)";
  if (bias === "Puts" && (structureBias === "Bearish Structure" || liquidityContext === "Below PDL")) return "Continuation (Bearish)";
  return "Wait / Range";
}

function computeCallScore(stock) {
  const structureBoost = stock.structureBias === "Bullish Structure" ? 22 : stock.structureBias === "Mixed Structure" ? 10 : 0;
  const locationBoost = stock.locationTag === "Near Support" ? 22 : stock.locationTag === "Mid Range" ? 6 : 0;
  const roomBoost = stock.roomToMove === "Good Room" ? 16 : stock.roomToMove === "Limited Room" ? 8 : 0;
  const liquidityBoost = ["Near PDL", "Above PDH"].includes(stock.liquidityContext) ? 18 : stock.liquidityContext === "Inside Prior Day Range" ? 8 : 0;
  const displacementBoost = stock.displacementLabel === "Strong" ? 12 : stock.displacementLabel === "Moderate" ? 8 : 3;
  const sessionBoost = ["Pre-London", "London Expansion"].includes(stock.sessionLabel) ? 10 : 5;
  return Math.round(clamp(structureBoost + locationBoost + roomBoost + liquidityBoost + displacementBoost + sessionBoost, 0, 100));
}

function computePutScore(stock) {
  const structureBoost = stock.structureBias === "Bearish Structure" ? 22 : stock.structureBias === "Mixed Structure" ? 10 : 0;
  const locationBoost = stock.locationTag === "Near Resistance" ? 22 : stock.locationTag === "Mid Range" ? 6 : 0;
  const roomBoost = stock.roomToMove === "Good Room" ? 16 : stock.roomToMove === "Limited Room" ? 8 : 0;
  const liquidityBoost = ["Near PDH", "Below PDL"].includes(stock.liquidityContext) ? 18 : stock.liquidityContext === "Inside Prior Day Range" ? 8 : 0;
  const displacementBoost = stock.displacementLabel === "Strong" ? 12 : stock.displacementLabel === "Moderate" ? 8 : 3;
  const sessionBoost = ["Pre-London", "London Expansion"].includes(stock.sessionLabel) ? 10 : 5;
  return Math.round(clamp(structureBoost + locationBoost + roomBoost + liquidityBoost + displacementBoost + sessionBoost, 0, 100));
}

function getTimingState(stock) {
  const atLiquidity = ["Near PDH", "Near PDL", "Above PDH", "Below PDL"].includes(stock.liquidityContext);
  const atLevel = stock.locationTag === "Near Support" || stock.locationTag === "Near Resistance" || atLiquidity;
  const sessionGood = ["Pre-London", "London Expansion"].includes(stock.sessionLabel);
  const noRoom = stock.roomToMove === "Poor Room";
  const weakImpulse = stock.displacementLabel === "Weak";
  const extension =
    (stock.bias === "Calls" && stock.liquidityContext === "Above PDH" && stock.roomToMove === "Poor Room") ||
    (stock.bias === "Puts" && stock.liquidityContext === "Below PDL" && stock.roomToMove === "Poor Room");

  if (noRoom || extension || (stock.locationTag === "Tight Range" && stock.liquidityContext === "Inside Prior Day Range")) return "AVOID";
  if (atLevel && sessionGood && stock.displacementLabel !== "Weak" && stock.bestScore >= 80) return "READY";
  if (atLevel && stock.bestScore >= 68) return "WATCH";
  if (!atLevel && stock.bestScore >= 68 && !weakImpulse) return "EARLY";
  return "AVOID";
}

function getSetupQuality(score) {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  return "C";
}

function buildReason(stock) {
  return `${stock.setupType} with ${stock.structureBias.toLowerCase()}, ${stock.liquidityContext.toLowerCase()}, ${stock.displacementLabel.toLowerCase()} displacement, ${stock.sessionLabel.toLowerCase()}, and ${stock.timingState.toLowerCase()} timing.`;
}

async function polygonFetch(path, apiKey) {
  const response = await fetch(`${POLYGON_BASE}${path}${path.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(apiKey)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.message || `Polygon request failed for ${path}`);
  return data;
}

async function fetchSymbolData(symbol, apiKey) {
  const to = new Date();
  const from = new Date(Date.now() - 1000 * 60 * 60 * 24 * 150);
  const formatDate = (d) => d.toISOString().slice(0, 10);

  const data = await polygonFetch(
    `/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${formatDate(from)}/${formatDate(to)}?adjusted=true&sort=desc&limit=100`,
    apiKey
  );

  const results = Array.isArray(data.results) ? data.results : [];
  if (results.length < 30) throw new Error(`Not enough daily data for ${symbol}`);

  const values = results.map((bar) => ({
    open: Number(bar.o),
    high: Number(bar.h),
    low: Number(bar.l),
    close: Number(bar.c),
    volume: Number(bar.v || 0),
  }));

  const closes = values.map((v) => v.close);
  const volumes = values.map((v) => v.volume);
  const current = values[0];
  const previous = values[1];
  const highs20 = values.slice(0, 20).map((v) => v.high);
  const lows20 = values.slice(0, 20).map((v) => v.low);

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const rsi14 = rsi(closes, 14);
  const avgVol20 = average(volumes.slice(1, 21).filter(Boolean));
  const relVolume = avgVol20 ? current.volume / avgVol20 : 1;
  const support20 = Math.min(...lows20);
  const resistance20 = Math.max(...highs20);
  const distanceToSupport = support20 > 0 ? ((current.close - support20) / current.close) * 100 : 0;
  const distanceToResistance = resistance20 > 0 ? ((resistance20 - current.close) / current.close) * 100 : 0;
  const dailyRangePct = current.close > 0 ? ((current.high - current.low) / current.close) * 100 : 0;
  const avgDollarVolume = average(values.slice(0, 20).map((v) => v.close * v.volume));

  const pdh = values[1].high;
  const pdl = values[1].low;

  const structure = getStructureBias(values);
  const location = getLocationTag(distanceToSupport, distanceToResistance);
  const liquidity = getLiquidityContext(current.close, pdh, pdl);
  const displacement = getDisplacement(values);
  const session = getSessionLabelEST();

  const initialBias = structure.bias === "Bullish Structure" ? "Calls" : structure.bias === "Bearish Structure" ? "Puts" : "Neutral";
  const room = getRoom(distanceToSupport, distanceToResistance, initialBias);

  const stock = {
    ticker: symbol,
    price: Number(current.close.toFixed(2)),
    percentChange: Number((previous?.close ? ((current.close - previous.close) / previous.close) * 100 : 0).toFixed(2)),
    structureBias: structure.bias,
    structureScore: structure.score,
    trend: sma20 && sma50 ? (current.close > sma20 && sma20 > sma50 ? "bullish" : current.close < sma20 && sma20 < sma50 ? "bearish" : "neutral") : "neutral",
    rsi: Number((rsi14 || 50).toFixed(1)),
    relVolume: Number(relVolume.toFixed(2)),
    distanceToSupport: Number(distanceToSupport.toFixed(2)),
    distanceToResistance: Number(distanceToResistance.toFixed(2)),
    support20: Number(support20.toFixed(2)),
    resistance20: Number(resistance20.toFixed(2)),
    locationTag: location.tag,
    locationScore: location.score,
    liquidityContext: liquidity.tag,
    liquidityScore: liquidity.score,
    displacementLabel: displacement.label,
    displacementScore: displacement.score,
    sessionLabel: session.label,
    sessionScore: session.score,
    roomToMove: room.tag,
    roomScore: room.score,
    dailyRangePct: Number(dailyRangePct.toFixed(2)),
    avgDollarVolume: Number(avgDollarVolume.toFixed(0)),
    pdh: Number(pdh.toFixed(2)),
    pdl: Number(pdl.toFixed(2)),
  };

  stock.callScore = computeCallScore(stock);
  stock.putScore = computePutScore(stock);
  stock.bestScore = Math.max(stock.callScore, stock.putScore);
  stock.bias = stock.callScore - stock.putScore >= 10 ? "Calls" : stock.putScore - stock.callScore >= 10 ? "Puts" : "Neutral";
  stock.setupType = getSetupType(stock.structureBias, stock.locationTag, stock.bias, stock.liquidityContext);
  stock.timingState = getTimingState(stock);
  stock.setupQuality = getSetupQuality(stock.bestScore);
  stock.finalTradeScore = Math.round(clamp(
    stock.bestScore * 0.50 +
    stock.liquidityScore * 0.15 +
    stock.displacementScore * 0.10 +
    stock.sessionScore * 0.08 +
    stock.structureScore * 0.07 +
    stock.locationScore * 0.05 +
    stock.roomScore * 0.05,
    0, 100
  ));
  stock.reason = buildReason(stock);

  let entrySignal = "NO TRADE";

  if (
    stock.liquidityScore >= 75 &&
    stock.displacementScore >= 65 &&
    stock.timingState === "READY" &&
    stock.bias !== "NEUTRAL"
  ) {
    entrySignal = "READY";
  } else if (
    stock.liquidityScore >= 70 &&
    stock.displacementScore >= 50 &&
    stock.timingState === "WATCH"
  ) {
    entrySignal = "WATCH";
  }

  const passesTickerFilter =
    stock.price >= 10 &&
    stock.relVolume >= 1.2 &&
    stock.avgDollarVolume >= 10000000 &&
    stock.dailyRangePct >= 2 &&
    stock.bias !== "Neutral";

  const passesSetupFilter = true;

  if (!passesTickerFilter) {
        return {
                ...stock,
                dataStatus: "SKIPPED",
                reason: "Failed ticker filter",
                entrySignal: "NO TRADE",
        };
  }

    if (!passesSetupFilter) {
          return {
                  ...stock,
                  dataStatus: "LOADED",
                  reason: "Did not meet setup quality threshold",
                  entrySignal: "NO TRADE",
          };
    }

    return {
          ...stock,
          dataStatus: "LOADED",
          entrySignal,
    };
}

export async function handler(event) {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) return json(500, { error: "Missing POLYGON_API_KEY in Netlify environment variables." });

  const symbols = parseSymbols(event.queryStringParameters?.symbols || "");
  if (!symbols.length) return json(400, { error: "Please pass at least one symbol, like ?symbols=AAPL,NVDA,TSLA" });

  const results = await Promise.allSettled(symbols.map((symbol) => fetchSymbolData(symbol, apiKey)));
  const rows = results.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
  const failures = results.filter((r) => r.status === "rejected").map((r) => r.reason?.message || "Unknown error");

  if (!rows.length) return json(502, { error: failures[0] || "No qualified setups passed the filters." });
  rows.sort((a, b) => b.finalTradeScore - a.finalTradeScore);

  return json(200, { rows, generatedAt: new Date().toISOString(), failures });
}
