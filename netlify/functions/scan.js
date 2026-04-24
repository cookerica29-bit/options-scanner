// v4 — BOS + Order Block strategy (replaces EMA/SMA pullback)
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

function average(values) {
  return values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : 0;
}

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

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

function atr(values, period = 14) {
  // values sorted newest-first
  if (values.length < period + 1) return values[0].high - values[0].low;
  const trs = values.slice(0, period).map((v, i) => {
    const prevClose = values[i + 1]?.close || v.close;
    return Math.max(v.high - v.low, Math.abs(v.high - prevClose), Math.abs(v.low - prevClose));
  });
  return average(trs);
}

// ── PRICE ACTION FUNCTIONS ────────────────────────────────────────────────────

// candles = oldest-first array
function findSwings(candles, margin = 3) {
  const swings = [];
  for (let i = margin; i < candles.length - margin; i++) {
    const slice = candles.slice(i - margin, i + margin + 1);
    const isHigh = candles[i].high === Math.max(...slice.map((c) => c.high));
    const isLow  = candles[i].low  === Math.min(...slice.map((c) => c.low));
    if (isHigh) swings.push({ index: i, price: candles[i].high, type: "high" });
    else if (isLow) swings.push({ index: i, price: candles[i].low,  type: "low"  });
  }
  return swings;
}

function getTrend(swings) {
  const highs = swings.filter((s) => s.type === "high");
  const lows  = swings.filter((s) => s.type === "low");
  if (highs.length < 2 || lows.length < 2) return "NEUTRAL";
  const lastHH = highs[highs.length - 1].price > highs[highs.length - 2].price;
  const lastHL = lows[lows.length - 1].price  > lows[lows.length - 2].price;
  const lastLH = highs[highs.length - 1].price < highs[highs.length - 2].price;
  const lastLL = lows[lows.length - 1].price  < lows[lows.length - 2].price;
  if (lastHH && lastHL) return "LONG";
  if (lastLH && lastLL) return "SHORT";
  return "NEUTRAL";
}

function detectBOS(candles, swings, direction, lookback = 40) {
  const highs  = swings.filter((s) => s.type === "high");
  const lows   = swings.filter((s) => s.type === "low");
  const minIdx = Math.max(0, candles.length - 1 - lookback);
  if (direction === "LONG" && highs.length >= 2) {
    const prevHigh = highs[highs.length - 2];
    for (let i = Math.max(prevHigh.index + 1, minIdx); i < candles.length; i++) {
      if (candles[i].close > prevHigh.price) return { confirmed: true, bosLevel: prevHigh.price };
    }
  }
  if (direction === "SHORT" && lows.length >= 2) {
    const prevLow = lows[lows.length - 2];
    for (let i = Math.max(prevLow.index + 1, minIdx); i < candles.length; i++) {
      if (candles[i].close < prevLow.price) return { confirmed: true, bosLevel: prevLow.price };
    }
  }
  return { confirmed: false, bosLevel: 0 };
}

function findOrderBlock(candles, direction, swings) {
  const lastIdx = candles.length - 1;
  if (direction === "LONG") {
    const lows = swings.filter((s) => s.type === "low");
    const lastSwingLow = lows[lows.length - 1];
    if (!lastSwingLow) return null;
    for (let i = lastIdx - 1; i >= lastSwingLow.index; i--) {
      if (candles[i].close < candles[i].open) return { high: candles[i].high, low: candles[i].low, index: i };
    }
  }
  if (direction === "SHORT") {
    const highs = swings.filter((s) => s.type === "high");
    const lastSwingHigh = highs[highs.length - 1];
    if (!lastSwingHigh) return null;
    for (let i = lastIdx - 1; i >= lastSwingHigh.index; i--) {
      if (candles[i].close > candles[i].open) return { high: candles[i].high, low: candles[i].low, index: i };
    }
  }
  return null;
}

// ── SUPPORTING FUNCTIONS ──────────────────────────────────────────────────────

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
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return { label: "Pre-Market",   score: 75 };
  if (minutes >= 9 * 60 + 30 && minutes < 11 * 60) return { label: "Market Open",  score: 92 };
  if (minutes >= 11 * 60 && minutes < 14 * 60)     return { label: "Midday",        score: 65 };
  if (minutes >= 14 * 60 && minutes < 16 * 60)     return { label: "Afternoon",     score: 80 };
  if (minutes >= 16 * 60 && minutes < 20 * 60)     return { label: "After Hours",   score: 50 };
  return { label: "Off Hours", score: 40 };
}

function getRoom(distanceToSupport, distanceToResistance, direction) {
  if (direction === "LONG") {
    if (distanceToResistance >= 4) return { tag: "Good Room",    score: 85 };
    if (distanceToResistance >= 2) return { tag: "Limited Room", score: 58 };
    return { tag: "Poor Room", score: 25 };
  }
  if (direction === "SHORT") {
    if (distanceToSupport >= 4) return { tag: "Good Room",    score: 85 };
    if (distanceToSupport >= 2) return { tag: "Limited Room", score: 58 };
    return { tag: "Poor Room", score: 25 };
  }
  return { tag: "Range", score: 35 };
}

function getSetupType(direction, bosConfirmed, inOB, liquidityContext) {
  if (!bosConfirmed) return "Wait / No BOS";
  if (direction === "LONG") {
    if (inOB && ["Near PDL", "Above PDH"].includes(liquidityContext)) return "Bullish OB + Liquidity";
    if (inOB) return "Bullish OB Entry";
    return "Bullish BOS — Waiting for OB";
  }
  if (direction === "SHORT") {
    if (inOB && ["Near PDH", "Below PDL"].includes(liquidityContext)) return "Bearish OB + Liquidity";
    if (inOB) return "Bearish OB Entry";
    return "Bearish BOS — Waiting for OB";
  }
  return "Wait / Range";
}

// structureScore reused for BOS, locationScore reused for OB proximity
function computeCallScore(stock) {
  const bosBoost    = stock.bosConfirmed ? 25 : 0;
  const obBoost     = stock.inOB ? 25 : stock.nearOB ? 12 : 0;
  const roomBoost   = stock.roomToMove === "Good Room" ? 12 : stock.roomToMove === "Limited Room" ? 6 : 0;
  const liqBoost    = ["Near PDL", "Above PDH"].includes(stock.liquidityContext) ? 15 :
                      stock.liquidityContext === "Inside Prior Day Range" ? 8 : 0;
  const dispBoost   = stock.displacementLabel === "Strong" ? 12 : stock.displacementLabel === "Moderate" ? 8 : 3;
  const sessBoost   = ["Market Open", "Afternoon"].includes(stock.sessionLabel) ? 10 :
                      stock.sessionLabel === "Pre-Market" ? 6 : 3;
  return Math.round(clamp(bosBoost + obBoost + roomBoost + liqBoost + dispBoost + sessBoost, 0, 100));
}

function computePutScore(stock) {
  const bosBoost    = stock.bosConfirmed ? 25 : 0;
  const obBoost     = stock.inOB ? 25 : stock.nearOB ? 12 : 0;
  const roomBoost   = stock.roomToMove === "Good Room" ? 12 : stock.roomToMove === "Limited Room" ? 6 : 0;
  const liqBoost    = ["Near PDH", "Below PDL"].includes(stock.liquidityContext) ? 15 :
                      stock.liquidityContext === "Inside Prior Day Range" ? 8 : 0;
  const dispBoost   = stock.displacementLabel === "Strong" ? 12 : stock.displacementLabel === "Moderate" ? 8 : 3;
  const sessBoost   = ["Market Open", "Afternoon"].includes(stock.sessionLabel) ? 10 :
                      stock.sessionLabel === "Pre-Market" ? 6 : 3;
  return Math.round(clamp(bosBoost + obBoost + roomBoost + liqBoost + dispBoost + sessBoost, 0, 100));
}

function getTimingState(stock) {
  if (!stock.bosConfirmed || stock.bias === "Neutral") return "AVOID";
  if (stock.inOB && stock.displacementLabel !== "Weak" && stock.finalTradeScore >= 75) return "READY";
  if ((stock.inOB || stock.nearOB) && stock.finalTradeScore >= 60) return "WATCH";
  if (stock.bosConfirmed && !stock.inOB && !stock.nearOB) return "EARLY";
  return "AVOID";
}

function getSetupQuality(score) {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  return "C";
}

function buildReason(stock) {
  if (!stock.bosConfirmed) return "No confirmed BOS — structure not clear yet.";
  if (stock.bias === "Calls" && stock.inOB)   return "Bullish BOS confirmed. Price returned to OB — potential call entry zone.";
  if (stock.bias === "Calls" && stock.nearOB) return "Bullish BOS confirmed. Price approaching OB — watch for call entry.";
  if (stock.bias === "Calls")                 return "Bullish BOS confirmed. Waiting for price to pull back into OB.";
  if (stock.bias === "Puts"  && stock.inOB)   return "Bearish BOS confirmed. Price returned to OB — potential put entry zone.";
  if (stock.bias === "Puts"  && stock.nearOB) return "Bearish BOS confirmed. Price approaching OB — watch for put entry.";
  if (stock.bias === "Puts")                  return "Bearish BOS confirmed. Waiting for price to pull back into OB.";
  return "Setup is developing.";
}

function buildBlockerReason(stock) {
  if (!stock.bosConfirmed)            return "No BOS confirmed — structure not established.";
  if (stock.bias === "Neutral")       return "Trend direction is unclear — no tradable bias.";
  if (!stock.inOB && !stock.nearOB)   return "BOS confirmed but price not yet at OB zone.";
  if (stock.relVolume < 1.2)          return "Low participation: relative volume below threshold.";
  if (stock.displacementScore < 50)   return "Weak momentum: displacement below minimum threshold.";
  if (stock.roomToMove === "Poor Room") return "Room to move is too limited.";
  return "Setup is forming but not yet tradable.";
}

// ── POLYGON ───────────────────────────────────────────────────────────────────

async function polygonFetch(path, apiKey) {
  const response = await fetch(`${POLYGON_BASE}${path}${path.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(apiKey)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.message || `Polygon request failed for ${path}`);
  return data;
}

async function fetchSymbolData(symbol, apiKey) {
  const to   = new Date();
  const from = new Date(Date.now() - 1000 * 60 * 60 * 24 * 150);
  const formatDate = (d) => d.toISOString().slice(0, 10);

  const data = await polygonFetch(
    `/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${formatDate(from)}/${formatDate(to)}?adjusted=true&sort=desc&limit=100`,
    apiKey
  );

  const results = Array.isArray(data.results) ? data.results : [];
  if (results.length < 30) throw new Error(`Not enough daily data for ${symbol}`);

  // newest-first (as returned by Polygon sort=desc)
  const values = results.map((bar) => ({
    open:   Number(bar.o),
    high:   Number(bar.h),
    low:    Number(bar.l),
    close:  Number(bar.c),
    volume: Number(bar.v || 0),
  }));

  const closes   = values.map((v) => v.close);
  const volumes  = values.map((v) => v.volume);
  const current  = values[0];
  const previous = values[1];

  // Oldest-first for price action functions
  const candlesAsc = [...values].reverse();
  const swings     = findSwings(candlesAsc, 3);
  const trend      = getTrend(swings);
  const bos        = trend !== "NEUTRAL" ? detectBOS(candlesAsc, swings, trend, 40) : { confirmed: false, bosLevel: 0 };
  const ob         = bos.confirmed ? findOrderBlock(candlesAsc, trend, swings) : null;
  const currentATR = atr(values, 14);

  // Is current price inside or near the OB?
  const inOB   = ob != null && current.close >= ob.low && current.close <= ob.high;
  const nearOB = ob != null && !inOB && (
    (trend === "LONG"  && current.close < ob.high && current.close > ob.low - currentATR) ||
    (trend === "SHORT" && current.close > ob.low  && current.close < ob.high + currentATR)
  );

  const avgVol20         = average(volumes.slice(1, 21).filter(Boolean));
  const relVolume        = avgVol20 ? current.volume / avgVol20 : 1;
  const highs20          = values.slice(0, 20).map((v) => v.high);
  const lows20           = values.slice(0, 20).map((v) => v.low);
  const support20        = Math.min(...lows20);
  const resistance20     = Math.max(...highs20);
  const distToSupport    = support20    > 0 ? ((current.close - support20)    / current.close) * 100 : 0;
  const distToResistance = resistance20 > 0 ? ((resistance20 - current.close) / current.close) * 100 : 0;
  const dailyRangePct    = current.close > 0 ? ((current.high - current.low)  / current.close) * 100 : 0;
  const avgDollarVolume  = average(values.slice(0, 20).map((v) => v.close * v.volume));
  const rsi14            = rsi(closes, 14);
  const pdh              = previous.high;
  const pdl              = previous.low;

  const location    = getLocationTag(distToSupport, distToResistance);
  const liquidity   = getLiquidityContext(current.close, pdh, pdl);
  const displacement = getDisplacement(values);
  const session     = getSessionLabelEST();
  const room        = getRoom(distToSupport, distToResistance, trend);

  const stock = {
    ticker:             symbol,
    price:              Number(current.close.toFixed(2)),
    percentChange:      Number((previous?.close ? ((current.close - previous.close) / previous.close) * 100 : 0).toFixed(2)),
    // Price action fields
    trend,
    bosConfirmed:       bos.confirmed,
    bosLevel:           bos.bosLevel ? Number(bos.bosLevel.toFixed(2)) : null,
    obHigh:             ob ? Number(ob.high.toFixed(2)) : null,
    obLow:              ob ? Number(ob.low.toFixed(2)) : null,
    inOB,
    nearOB,
    atr:                Number(currentATR.toFixed(2)),
    // Scores (structureScore = BOS score, locationScore = OB proximity score)
    structureScore:     bos.confirmed ? 90 : 45,
    locationScore:      inOB ? 90 : nearOB ? 65 : 40,
    // Supporting context
    rsi:                Number((rsi14 || 50).toFixed(1)),
    relVolume:          Number(relVolume.toFixed(2)),
    distanceToSupport:  Number(distToSupport.toFixed(2)),
    distanceToResistance: Number(distToResistance.toFixed(2)),
    support20:          Number(support20.toFixed(2)),
    resistance20:       Number(resistance20.toFixed(2)),
    locationTag:        location.tag,
    locationScore:      location.score,
    liquidityContext:   liquidity.tag,
    liquidityScore:     liquidity.score,
    displacementLabel:  displacement.label,
    displacementScore:  displacement.score,
    sessionLabel:       session.label,
    sessionScore:       session.score,
    roomToMove:         room.tag,
    roomScore:          room.score,
    dailyRangePct:      Number(dailyRangePct.toFixed(2)),
    avgDollarVolume:    Number(avgDollarVolume.toFixed(0)),
    pdh:                Number(pdh.toFixed(2)),
    pdl:                Number(pdl.toFixed(2)),
  };

  // Override structureScore and locationScore with PA values
  stock.structureScore = bos.confirmed ? 90 : 45;
  stock.locationScore  = inOB ? 90 : nearOB ? 65 : 40;

  stock.callScore      = computeCallScore(stock);
  stock.putScore       = computePutScore(stock);
  stock.bestScore      = Math.max(stock.callScore, stock.putScore);
  stock.bias           = trend === "LONG" && bos.confirmed ? "Calls" :
                         trend === "SHORT" && bos.confirmed ? "Puts" : "Neutral";
  stock.setupType      = getSetupType(trend, bos.confirmed, inOB, liquidity.tag);
  stock.finalTradeScore = Math.round(clamp(
    stock.bestScore      * 0.50 +
    stock.liquidityScore * 0.15 +
    stock.displacementScore * 0.10 +
    stock.sessionScore   * 0.08 +
    stock.structureScore * 0.07 +
    stock.locationScore  * 0.05 +
    stock.roomScore      * 0.05,
    0, 100
  ));
  stock.timingState    = getTimingState(stock);
  stock.setupQuality   = getSetupQuality(stock.bestScore);
  stock.reason         = buildReason(stock);
  stock.blockerReason  = buildBlockerReason(stock);

  let entrySignal = "NO_TRADE";
  if (
    stock.bosConfirmed &&
    stock.inOB &&
    stock.bias !== "Neutral" &&
    stock.displacementScore >= 65 &&
    stock.timingState === "READY" &&
    stock.finalTradeScore >= 75
  ) {
    entrySignal = "READY";
  } else if (
    stock.bosConfirmed &&
    (stock.inOB || stock.nearOB) &&
    stock.bias !== "Neutral" &&
    stock.finalTradeScore >= 60
  ) {
    entrySignal = "WATCH";
  }

  const passesTickerFilter =
    stock.price >= 5 &&
    stock.relVolume >= 1.0 &&
    stock.avgDollarVolume >= 5000000 &&
    stock.dailyRangePct >= 1;

  const passesSetupFilter = stock.bosConfirmed && stock.bias !== "Neutral";

  if (!passesTickerFilter) {
    return { ...stock, dataStatus: "SKIPPED", reason: "Low participation: price, volume, or range below threshold.", entrySignal: "NO_TRADE" };
  }
  if (!passesSetupFilter) {
    return { ...stock, dataStatus: "LOADED", reason: "No confirmed BOS — waiting for structure.", entrySignal: "NO_TRADE" };
  }
  return { ...stock, dataStatus: "LOADED", entrySignal };
}

export async function handler(event) {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) return json(500, { error: "Missing POLYGON_API_KEY in Netlify environment variables." });

  const symbols = parseSymbols(event.queryStringParameters?.symbols || "");
  if (!symbols.length) return json(400, { error: "Please pass at least one symbol, like ?symbols=AAPL,NVDA,TSLA" });

  const results  = await Promise.allSettled(symbols.map((symbol) => fetchSymbolData(symbol, apiKey)));
  const rows     = results.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
  const failures = results.filter((r) => r.status === "rejected").map((r) => r.reason?.message || "Unknown error");

  if (!rows.length) return json(502, { error: failures[0] || "No data returned." });

  rows.sort((a, b) => b.finalTradeScore - a.finalTradeScore);
  return json(200, { rows, generatedAt: new Date().toISOString(), failures });
}
