
import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Search,
  RefreshCw,
  AlertCircle,
  Radar,
  CandlestickChart,
  Target,
  Shapes,
  ShieldCheck,
  Clock3,
  Activity,
} from "lucide-react";

const defaultSymbols = "AAPL,NVDA,AMD,TSLA,META,PLTR,AMZN,NFLX,SOFI,BA";
const timingOrder = { READY: 0, WATCH: 1, EARLY: 2, AVOID: 3 };
const entrySignalOrder = { READY: 0, WATCH: 1, NO_TRADE: 2 };

function scoreClass(score) {
  if (score >= 80) return "score score-strong";
  if (score >= 65) return "score score-good";
  if (score >= 50) return "score score-watch";
  return "score";
}
function biasClass(bias) {
  if (bias === "Calls") return "pill pill-calls";
  if (bias === "Puts") return "pill pill-puts";
  return "pill";
}
function qualityClass(label) {
  if (label === "A") return "pill pill-calls";
  if (label === "B") return "pill pill-watch";
  return "pill pill-puts";
}
function timingClass(label) {
  if (label === "READY") return "timing timing-ready";
  if (label === "WATCH") return "timing timing-watch";
  if (label === "EARLY") return "timing timing-early";
  return "timing timing-avoid";
}
function fmt(value, decimals = 2) {
  if (value == null || Number.isNaN(value)) return "—";
  return Number(value).toFixed(decimals);
}

export default function App() {
  const [symbolsInput, setSymbolsInput] = useState(defaultSymbols);
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState("all");
  const [sortBy, setSortBy] = useState("trade");
  const [rows, setRows] = useState([]);
  const [scanStatus, setScanStatus] = useState("idle");
  const [scanError, setScanError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");

  const [selectedTicker, setSelectedTicker] = useState("");
  const [contractSide, setContractSide] = useState("calls");
  const [minVolume, setMinVolume] = useState(100);
  const [minOpenInterest, setMinOpenInterest] = useState(250);
  const [maxSpreadPct, setMaxSpreadPct] = useState(8);
  const [minDeltaAbs, setMinDeltaAbs] = useState(0.25);
  const [maxDeltaAbs, setMaxDeltaAbs] = useState(0.65);
  const [maxExpirations, setMaxExpirations] = useState(3);
  const [contracts, setContracts] = useState([]);
  const [bestContracts, setBestContracts] = useState([]);
  const [contractStatus, setContractStatus] = useState("idle");
  const [contractError, setContractError] = useState("");
  const [contractMeta, setContractMeta] = useState(null);

  async function runScan() {
    setScanStatus("loading");
    setScanError("");
    try {
      const response = await fetch(`/.netlify/functions/scan?symbols=${encodeURIComponent(symbolsInput)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load scan data.");

      setRows(data.rows || []);
      setLastUpdated(data.generatedAt || "");
      setScanStatus("success");

      if (data.rows?.length && !selectedTicker) {
        const first = data.rows[0];
        setSelectedTicker(first.ticker);
        setContractSide(first.bias === "Puts" ? "puts" : "calls");
      }
    } catch (err) {
      setScanError(err.message || "Unable to fetch scan data.");
      setScanStatus("error");
    }
  }

  async function loadContracts(overrideTicker, overrideSide) {
    const ticker = overrideTicker || selectedTicker;
    const side = overrideSide || contractSide;
    if (!ticker) {
      setContractStatus("error");
      setContractError("Pick a ticker first.");
      return;
    }

    setContractStatus("loading");
    setContractError("");
    try {
      const query = new URLSearchParams({
        symbol: ticker,
        side,
        minVolume: String(minVolume),
        minOpenInterest: String(minOpenInterest),
        maxSpreadPct: String(maxSpreadPct),
        minDeltaAbs: String(minDeltaAbs),
        maxDeltaAbs: String(maxDeltaAbs),
        expirations: String(maxExpirations),
      });

      const response = await fetch(`/.netlify/functions/option-chain?${query.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load option contracts.");

      setContracts(data.contracts || []);
      setBestContracts(data.bestContracts || []);
      setContractMeta({
        symbol: data.symbol,
        side: data.side,
        underlyingPrice: data.underlyingPrice,
        expirationsUsed: data.expirationsUsed || [],
      });
      setContractStatus("success");
    } catch (err) {
      setContracts([]);
      setBestContracts([]);
      setContractMeta(null);
      setContractError(err.message || "Unable to fetch option contracts.");
      setContractStatus("error");
    }
  }

  const filtered = useMemo(() => {
    const list = rows.filter((stock) => {
      const matchesSearch = stock.ticker.toLowerCase().includes(search.toLowerCase());
      const matchesDirection =
        direction === "all" ||
        (direction === "calls" && stock.bias === "Calls") ||
        (direction === "puts" && stock.bias === "Puts");
      return matchesSearch && matchesDirection;
    });

    list.sort((a, b) => {
      if (sortBy === "signal") return entrySignalOrder[a.entrySignal] - entrySignalOrder[b.entrySignal];
      if (sortBy === "timing") return timingOrder[a.timingState] - timingOrder[b.timingState];
      if (sortBy === "liquidity") return b.liquidityScore - a.liquidityScore;
      if (sortBy === "displacement") return b.displacementScore - a.displacementScore;
      return b.finalTradeScore - a.finalTradeScore;
    });
    return list;
  }, [rows, search, direction, sortBy]);

  const selectedRow = filtered.find((r) => r.ticker === selectedTicker) || rows.find((r) => r.ticker === selectedTicker);

  return (
    <div className="page">
      <div className="container">
        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="hero-grid">
          <div className="card hero-card">
            <div className="label"><Radar size={15} /> Part 2 Precision Layer</div>
            <h1>PDH / PDL + EST session + displacement</h1>
            <p>
              This version upgrades the decision engine with previous-day liquidity context, EST session labels,
              displacement strength, and tighter timing logic built around how you actually trade.
            </p>
            <div className="hero-stats">
              <div className="mini-stat"><span>Qualified Setups</span><strong>{rows.length}</strong></div>
              <div className="mini-stat"><span>Best Contracts</span><strong>{bestContracts.length}</strong></div>
              <div className="mini-stat"><span>Mode</span><strong>EST</strong></div>
            </div>
          </div>

          <div className="card side-card">
            <h3><Target size={18} /> Precision add-ons</h3>
            <div className="note"><strong>Liquidity context:</strong> Near PDH, Near PDL, Above PDH, Below PDL, or inside prior day range.</div>
            <div className="note"><strong>Session:</strong> EST-based labels built for your workflow, including Asia, Pre-London, London Expansion, and Post-Move.</div>
            <div className="note"><strong>Displacement:</strong> strong, moderate, or weak based on current impulse vs recent average range.</div>
            <div className="note"><strong>Timing:</strong> READY, WATCH, EARLY, or AVOID now factors in liquidity and session context.</div>
          </div>
        </motion.section>

        <section className="card filter-card">
          <div className="filter-grid live-grid">
            <div className="field live-symbols">
              <label>Watchlist symbols</label>
              <textarea value={symbolsInput} onChange={(e) => setSymbolsInput(e.target.value)} placeholder="AAPL,NVDA,AMD,TSLA" />
            </div>
            <div className="field">
              <label>Search ticker</label>
              <div className="input-wrap">
                <Search size={16} className="input-icon" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="AAPL, NVDA..." />
              </div>
            </div>
            <div className="field">
              <label>Direction</label>
              <select value={direction} onChange={(e) => setDirection(e.target.value)}>
                <option value="all">All</option>
                <option value="calls">Calls</option>
                <option value="puts">Puts</option>
              </select>
            </div>
            <div className="field">
              <label>Sort by</label>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="signal">Entry signal</option>
              <option value="trade">Trade score</option>
                <option value="timing">Timing</option>
                <option value="liquidity">Liquidity context</option>
                <option value="displacement">Displacement</option>
              </select>
            </div>
            <div className="field hint-field">
              <label>Filter rule</label>
              <div className="pill-row">
                <span className="pill">A only</span>
                <span className="pill">Strong B only</span>
              </div>
            </div>
            <div className="field action-field">
              <label>Run scan</label>
              <button className="run-button" onClick={runScan} disabled={scanStatus === "loading"}>
                <RefreshCw size={16} className={scanStatus === "loading" ? "spin" : ""} />
                {scanStatus === "loading" ? "Scanning..." : "Scan live data"}
              </button>
            </div>
          </div>
          {lastUpdated && <div className="subtle">Last updated: {new Date(lastUpdated).toLocaleString()}</div>}
          {scanStatus === "error" && (
            <div className="error-box">
              <AlertCircle size={16} />
              <span>{scanError}</span>
            </div>
          )}
        </section>

        {selectedRow && (
          <section className="dashboard-grid">
            <div className="card overview-card">
              <div className="section-title"><CandlestickChart size={18} /> Selected setup</div>
              <div className="overview-grid">
                <div className="metric-box"><span>Ticker</span><strong>{selectedRow.ticker}</strong></div>
                <div className="metric-box"><span>Bias</span><strong>{selectedRow.bias}</strong></div>
                <div className="metric-box"><span>Quality</span><strong>{selectedRow.setupQuality}</strong></div>
                <div className="metric-box"><span>Trade score</span><strong>{selectedRow.finalTradeScore}</strong></div>
              </div>
              <div className="chips">
                <span className={biasClass(selectedRow.bias)}>{selectedRow.bias}</span>
                <span className={qualityClass(selectedRow.setupQuality)}>{selectedRow.setupQuality}</span>
                <span className={timingClass(selectedRow.timingState)}><span className="timing-dot"></span>{selectedRow.timingState}</span>
                <span className="pill">{selectedRow.setupType}</span>
                <span className="pill">{selectedRow.liquidityContext}</span>
                <span className="pill">{selectedRow.sessionLabel}</span>
                <span className="pill">{selectedRow.displacementLabel}</span>
              </div>
              <p className="reason">{selectedRow.reason}</p>
            </div>

            <div className="card intelligence-card">
              <div className="section-title"><Activity size={18} /> Precision readout</div>
              <div className="intelligence-grid">
                <div className="detail"><span>Structure</span><strong>{selectedRow.structureScore}</strong></div>
                <div className="detail"><span>Location</span><strong>{selectedRow.locationScore}</strong></div>
                <div className="detail"><span>Liquidity</span><strong>{selectedRow.liquidityScore}</strong></div>
                <div className="detail"><span>Displacement</span><strong>{selectedRow.displacementScore}</strong></div>
                <div className="detail"><span>Session</span><strong>{selectedRow.sessionScore}</strong></div>
                <div className="detail"><span>Room</span><strong>{selectedRow.roomScore}</strong></div>
                <div className="detail"><span>PDH</span><strong>${selectedRow.pdh}</strong></div>
                <div className="detail"><span>PDL</span><strong>${selectedRow.pdl}</strong></div>
              </div>
            </div>
          </section>
        )}

        <section className="content-grid">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="card">
            <div className="section-title"><ShieldCheck size={18} /> Qualified setups</div>
            <div className="setup-list">
              {filtered.length === 0 ? (
                <div className="empty-state">
                  <h3>No qualified setups yet</h3>
                  <p>Run the scan to populate the precision shortlist.</p>
                </div>
              ) : (
                filtered.map((stock) => (
                  <button
                    key={stock.ticker}
                    className={`setup-card selectable-card ${selectedTicker === stock.ticker ? "selected-card" : ""}`}
                    onClick={() => {
                      setSelectedTicker(stock.ticker);
                      setContractSide(stock.bias === "Puts" ? "puts" : "calls");
                    }}
                  >
                    <div className="setup-top">
                      <div>
                        <div className="ticker-row">
                          <h3>{stock.ticker}</h3>
                          <span className={biasClass(stock.bias)}>{stock.bias}</span>
                          <span className={qualityClass(stock.setupQuality)}>{stock.setupQuality}</span>
                          <span className={timingClass(stock.timingState)}><span className="timing-dot"></span>{stock.timingState}</span>
                          <span className="pill">{stock.liquidityContext}</span>
                          <span className="pill">{stock.sessionLabel}</span>
                        <div className={`entry-signal ${stock.entrySignal}`}>{stock.entrySignal.replace("_", " ")}</div>
                        </div>
                        <p className="meta">{stock.reason}</p>
                      </div>
                      <div className="score-grid">
                        <div className={scoreClass(stock.bestScore)}><span>Setup</span><strong>{stock.bestScore}</strong></div>
                        <div className={scoreClass(stock.finalTradeScore)}><span>Trade</span><strong>{stock.finalTradeScore}</strong></div>
                        <div className={scoreClass(stock.liquidityScore)}><span>Liquidity</span><strong>{stock.liquidityScore}</strong></div>
                        <div className={scoreClass(stock.displacementScore)}><span>Displacement</span><strong>{stock.displacementScore}</strong></div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </motion.div>

          <div className="right-rail">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="card">
              <div className="section-title"><Target size={18} /> Best contracts today</div>
              <div className="rail-list">
                {bestContracts.length === 0 ? (
                  <div className="note">Select a setup and load contracts to see the top picks.</div>
                ) : (
                  bestContracts.map((c, idx) => (
                    <div key={c.symbol} className="rail-item rail-item-column">
                      <div>
                        <strong>#{idx + 1} {c.symbol}</strong>
                        <span>{c.expiration} · Strike {fmt(c.strike)}</span>
                      </div>
                      <div className="mini-metrics">
                        <span>Score {c.contractScore}</span>
                        <span>Δ {fmt(c.delta, 3)}</span>
                        <span>Spread {fmt(c.spreadPct)}%</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }} className="card">
              <div className="section-title"><Clock3 size={18} /> Contract filter</div>
              <div className="contract-toolbar compact-toolbar">
                <div className="field">
                  <label>Selected ticker</label>
                  <select value={selectedTicker} onChange={(e) => setSelectedTicker(e.target.value)}>
                    <option value="">Pick a ticker</option>
                    {rows.map((row) => (
                      <option key={row.ticker} value={row.ticker}>{row.ticker}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Contract side</label>
                  <select value={contractSide} onChange={(e) => setContractSide(e.target.value)}>
                    <option value="calls">Calls</option>
                    <option value="puts">Puts</option>
                  </select>
                </div>
                <div className="field"><label>Min vol</label><input type="number" value={minVolume} onChange={(e) => setMinVolume(Number(e.target.value || 0))} /></div>
                <div className="field"><label>Min OI</label><input type="number" value={minOpenInterest} onChange={(e) => setMinOpenInterest(Number(e.target.value || 0))} /></div>
                <div className="field"><label>Max spread %</label><input type="number" step="0.5" value={maxSpreadPct} onChange={(e) => setMaxSpreadPct(Number(e.target.value || 0))} /></div>
                <div className="field"><label>Min |delta|</label><input type="number" step="0.05" value={minDeltaAbs} onChange={(e) => setMinDeltaAbs(Number(e.target.value || 0))} /></div>
                <div className="field"><label>Max |delta|</label><input type="number" step="0.05" value={maxDeltaAbs} onChange={(e) => setMaxDeltaAbs(Number(e.target.value || 0))} /></div>
                <div className="field"><label>Nearest exps</label><input type="number" min="1" max="6" value={maxExpirations} onChange={(e) => setMaxExpirations(Number(e.target.value || 1))} /></div>
                <div className="field action-field">
                  <label>Load contracts</label>
                  <button className="run-button" onClick={() => loadContracts()} disabled={contractStatus === "loading"}>
                    <RefreshCw size={16} className={contractStatus === "loading" ? "spin" : ""} />
                    {contractStatus === "loading" ? "Loading..." : "Load"}
                  </button>
                </div>
              </div>
              {contractMeta && (
                <div className="chips padded">
                  <span className="pill">{contractMeta.symbol}</span>
                  <span className="pill">{contractMeta.side}</span>
                  <span className="pill">Underlying ${fmt(contractMeta.underlyingPrice)}</span>
                  {contractMeta.expirationsUsed.map((exp) => <span key={exp} className="pill">{exp}</span>)}
                </div>
              )}
              {contractStatus === "error" && (
                <div className="error-box padded">
                  <AlertCircle size={16} />
                  <span>{contractError}</span>
                </div>
              )}
            </motion.div>
          </div>
        </section>

        <section className="card contract-panel">
          <div className="section-title"><Shapes size={18} /> Contract table</div>
          {contracts.length === 0 ? (
            <div className="empty-state contract-empty">
              <h3>No contracts loaded</h3>
              <p>Pick a setup and load contracts to see ranked options.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="contract-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Symbol</th>
                    <th>Exp</th>
                    <th>Strike</th>
                    <th>Bid</th>
                    <th>Ask</th>
                    <th>Spread %</th>
                    <th>Volume</th>
                    <th>Open Int</th>
                    <th>Delta</th>
                    <th>IV</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((item, idx) => (
                    <tr key={item.symbol}>
                      <td>{idx + 1}</td>
                      <td className="mono">{item.symbol}</td>
                      <td>{item.expiration}</td>
                      <td>{fmt(item.strike)}</td>
                      <td>{fmt(item.bid)}</td>
                      <td>{fmt(item.ask)}</td>
                      <td>{fmt(item.spreadPct)}</td>
                      <td>{item.volume}</td>
                      <td>{item.openInterest}</td>
                      <td>{fmt(item.delta, 3)}</td>
                      <td>{fmt(item.iv, 3)}</td>
                      <td><span className={scoreClass(item.contractScore)}>{item.contractScore}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
