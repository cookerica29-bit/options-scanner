import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
        Search, RefreshCw, AlertCircle, Radar, CandlestickChart,
        Target, Shapes, ShieldCheck, Clock3, Activity,
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
        if (value == null || Number.isNaN(value)) return "---";
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
        const [journal, setJournal] = useState(() => {
                  try { const s = localStorage.getItem("scannerJournal"); return s ? JSON.parse(s) : []; }
                  catch (e) { return []; }
        });

  useEffect(() => {
            localStorage.setItem("scannerJournal", JSON.stringify(journal));
  }, [journal]);

  useEffect(() => {
            const ready = rows.filter((r) => r.entrySignal === "READY");
            if (ready.length > 0) {
                        const tickers = ready.map((r) => r.ticker).join(", ");
                        console.log("READY setups:", tickers);
                        if ("Notification" in window && Notification.permission === "granted") {
                                      new Notification("READY Setup Detected", { body: "Scanner found: " + tickers });
                        }
            }
  }, [rows]);

  useEffect(() => {
            if ("Notification" in window && Notification.permission === "default") {
                        Notification.requestPermission();
            }
  }, []);

  function saveToJournal(stock) {
            const entry = {
                        id: stock.ticker + "-" + Date.now(),
                        date: new Date().toLocaleDateString(),
                        time: new Date().toLocaleTimeString(),
                        ticker: stock.ticker,
                        bias: stock.bias,
                        setupType: stock.setupType,
                        setupQuality: stock.setupQuality,
                        timingState: stock.timingState,
                        entrySignal: stock.entrySignal,
                        setupScore: stock.bestScore,
                        finalTradeScore: stock.finalTradeScore,
                        liquidityScore: stock.liquidityScore,
                        displacementScore: stock.displacementScore,
                        sessionLabel: stock.sessionLabel,
                        liquidityContext: stock.liquidityContext,
                        reason: stock.reason,
                        tradeTaken: "No",
                        outcome: "",
                        notes: "",
            };
            setJournal((prev) => [entry, ...prev]);
  }

  function updateJournalEntry(id, field, value) {
            setJournal((prev) => prev.map((item) => item.id === id ? Object.assign({}, item, { [field]: value }) : item));
  }

  function deleteJournalEntry(id) {
            setJournal((prev) => prev.filter((item) => item.id !== id));
  }

  async function runScan() {
            setScanStatus("loading");
            setScanError("");
            try {
                        const res = await fetch("/.netlify/functions/scan?symbols=" + encodeURIComponent(symbolsInput));
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error || "Failed to load scan data.");
                        setRows(data.rows || []);
                        setLastUpdated(data.generatedAt || "");
                        setScanStatus("success");
                        if (data.rows && data.rows.length && !selectedTicker) {
                                      setSelectedTicker(data.rows[0].ticker);
                                      setContractSide(data.rows[0].bias === "Puts" ? "puts" : "calls");
                        }
            } catch (err) {
                        setScanError(err.message || "Unable to fetch scan data.");
                        setScanStatus("error");
            }
  }

  async function loadContracts(overrideTicker, overrideSide) {
            const ticker = overrideTicker || selectedTicker;
            const side = overrideSide || contractSide;
            if (!ticker) { setContractStatus("error"); setContractError("Pick a ticker first."); return; }
            setContractStatus("loading");
            setContractError("");
            try {
                        const q = new URLSearchParams({ symbol: ticker, side,
                                                               minVolume: String(minVolume), minOpenInterest: String(minOpenInterest),
                                                               maxSpreadPct: String(maxSpreadPct), minDeltaAbs: String(minDeltaAbs),
                                                               maxDeltaAbs: String(maxDeltaAbs), expirations: String(maxExpirations) });
                        const res = await fetch("/.netlify/functions/option-chain?" + q.toString());
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error || "Failed to load option contracts.");
                        setContracts(data.contracts || []);
                        setBestContracts(data.bestContracts || []);
                        setContractMeta({ symbol: data.symbol, side: data.side, underlyingPrice: data.underlyingPrice, expirationsUsed: data.expirationsUsed || [] });
                        setContractStatus("success");
            } catch (err) {
                        setContracts([]); setBestContracts([]); setContractMeta(null);
                        setContractError(err.message || "Unable to fetch option contracts.");
                        setContractStatus("error");
            }
  }

  const filtered = useMemo(() => {
            const list = rows.filter((s) => {
                        const ms = s.ticker.toLowerCase().includes(search.toLowerCase());
                        const md = direction === "all" || (direction === "calls" && s.bias === "Calls") || (direction === "puts" && s.bias === "Puts");
                        return ms && md;
            });
            list.sort((a, b) => {
                        if (sortBy === "signal") return (entrySignalOrder[a.entrySignal] != null ? entrySignalOrder[a.entrySignal] : 2) - (entrySignalOrder[b.entrySignal] != null ? entrySignalOrder[b.entrySignal] : 2);
                        if (sortBy === "timing") return timingOrder[a.timingState] - timingOrder[b.timingState];
                        if (sortBy === "liquidity") return b.liquidityScore - a.liquidityScore;
                        if (sortBy === "displacement") return b.displacementScore - a.displacementScore;
                        return b.finalTradeScore - a.finalTradeScore;
            });
            return list;
  }, [rows, search, direction, sortBy]);

  const selectedRow = filtered.find((r) => r.ticker === selectedTicker) || rows.find((r) => r.ticker === selectedTicker);

  function SignalBadge({ signal }) {
            let label = "NO TRADE";
            if (signal === "READY") label = "READY";
            if (signal === "WATCH") label = "WATCH";
            return <div className={"entry-signal " + signal}>{label}</div>div>;
  }

  return (
            <div className="page">
                  <div className="container">
                          <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="hero-grid">
                                    <div className="card hero-card">
                                                <div className="label"><Radar size={15} /> Part 2 Precision Layer</div>div>
                                                <h1>PDH / PDL + EST session + displacement</h1>h1>
                                                <p>This version upgrades the decision engine with previous-day liquidity context, EST session labels, displacement strength, and tighter timing logic built around how you actually trade.</p>p>
                                                <div className="hero-stats">
                                                              <div className="mini-stat"><span>Qualified Setups</span>span><strong>{rows.length}</strong>strong></div>div>
                                                              <div className="mini-stat"><span>Best Contracts</span>span><strong>{bestContracts.length}</strong>strong></div>div>
                                                              <div className="mini-stat"><span>Mode</span>span><strong>EST</strong>strong></div>div>
                                                </div>div>
                                    </div>div>
                                    <div className="card side-card">
                                                <h3><Target size={18} /> Precision add-ons</h3>h3>
                                                <div className="note"><strong>Liquidity context:</strong>strong> Near PDH, Near PDL, Above PDH, Below PDL, or inside prior day range.</div>div>
                                                <div className="note"><strong>Session:</strong>strong> EST-based labels built for your workflow, including Asia, Pre-London, London Expansion, and Post-Move.</div>div>
                                                <div className="note"><strong>Displacement:</strong>strong> strong, moderate, or weak based on current impulse vs recent average range.</div>div>
                                                <div className="note"><strong>Timing:</strong>strong> READY, WATCH, EARLY, or AVOID now factors in liquidity and session context.</div>div>
                                    </div>div>
                          </motion.section>motion.section>
                  
                          <section className="card filter-card">
                                    <div className="filter-grid live-grid">
                                                <div className="field live-symbols">
                                                              <label>Watchlist symbols</label>label>
                                                              <textarea value={symbolsInput} onChange={(e) => setSymbolsInput(e.target.value)} placeholder="AAPL,NVDA,AMD,TSLA" />
                                                </div>div>
                                                <div className="field">
                                                              <label>Search ticker</label>label>
                                                              <div className="input-wrap">
                                                                              <Search size={16} className="input-icon" />
                                                                              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="AAPL, NVDA..." />
                                                              </div>div>
                                                </div>div>
                                                <div className="field">
                                                              <label>Direction</label>label>
                                                              <select value={direction} onChange={(e) => setDirection(e.target.value)}>
                                                                              <option value="all">All</option>option>
                                                                              <option value="calls">Calls</option>option>
                                                                              <option value="puts">Puts</option>option>
                                                              </select>select>
                                                </div>div>
                                                <div className="field">
                                                              <label>Sort by</label>label>
                                                              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                                                                              <option value="trade">Trade score</option>option>
                                                                              <option value="signal">Entry signal</option>option>
                                                                              <option value="timing">Timing</option>option>
                                                                              <option value="liquidity">Liquidity context</option>option>
                                                                              <option value="displacement">Displacement</option>option>
                                                              </select>select>
                                                </div>div>
                                                <div className="field hint-field">
                                                              <label>Filter rule</label>label>
                                                              <div className="pill-row">
                                                                              <span className="pill">A only</span>span>
                                                                              <span className="pill">Strong B only</span>span>
                                                              </div>div>
                                                </div>div>
                                                <div className="field action-field">
                                                              <label>Run scan</label>label>
                                                              <button className="run-button" onClick={runScan} disabled={scanStatus === "loading"}>
                                                                              <RefreshCw size={16} className={scanStatus === "loading" ? "spin" : ""} />
                                                                    {scanStatus === "loading" ? "Scanning..." : "Scan live data"}
                                                              </button>button>
                                                </div>div>
                                    </div>div>
                                {lastUpdated && <div className="subtle">Last updated: {new Date(lastUpdated).toLocaleString()}</div>div>}
                                {scanStatus === "error" && (<div className="error-box"><AlertCircle size={16} /><span>{scanError}</span>span></div>div>)}
                          </section>section>
                  
                        {selectedRow && (
                            <section className="dashboard-grid">
                                        <div className="card overview-card">
                                                      <div className="section-title"><CandlestickChart size={18} /> Selected setup</div>div>
                                                      <div className="overview-grid">
                                                                      <div className="metric-box"><span>Ticker</span>span><strong>{selectedRow.ticker}</strong>strong></div>div>
                                                                      <div className="metric-box"><span>Bias</span>span><strong>{selectedRow.bias}</strong>strong></div>div>
                                                                      <div className="metric-box"><span>Quality</span>span><strong>{selectedRow.setupQuality}</strong>strong></div>div>
                                                                      <div className="metric-box"><span>Trade score</span>span><strong>{selectedRow.finalTradeScore}</strong>strong></div>div>
                                                      </div>div>
                                                      <div className="chips">
                                                                      <span className={biasClass(selectedRow.bias)}>{selectedRow.bias}</span>span>
                                                                      <span className={qualityClass(selectedRow.setupQuality)}>{selectedRow.setupQuality}</span>span>
                                                                      <span className={timingClass(selectedRow.timingState)}><span className="timing-dot"></span>span>{selectedRow.timingState}</span>span>
                                                                      <span className="pill">{selectedRow.setupType}</span>span>
                                                                      <span className="pill">{selectedRow.liquidityContext}</span>span>
                                                                      <span className="pill">{selectedRow.sessionLabel}</span>span>
                                                                      <span className="pill">{selectedRow.displacementLabel}</span>span>
                                                      </div>div>
                                                      <p className="reason">{selectedRow.reason}</p>p>
                                        </div>div>
                                        <div className="card intelligence-card">
                                                      <div className="section-title"><Activity size={18} /> Precision readout</div>div>
                                                      <div className="intelligence-grid">
                                                                      <div className="detail"><span>Structure</span>span><strong>{selectedRow.structureScore}</strong>strong></div>div>
                                                                      <div className="detail"><span>Location</span>span><strong>{selectedRow.locationScore}</strong>strong></div>div>
                                                                      <div className="detail"><span>Liquidity</span>span><strong>{selectedRow.liquidityScore}</strong>strong></div>div>
                                                                      <div className="detail"><span>Displacement</span>span><strong>{selectedRow.displacementScore}</strong>strong></div>div>
                                                                      <div className="detail"><span>Session</span>span><strong>{selectedRow.sessionScore}</strong>strong></div>div>
                                                                      <div className="detail"><span>Room</span>span><strong>{selectedRow.roomScore}</strong>strong></div>div>
                                                                      <div className="detail"><span>PDH</span>span><strong>${selectedRow.pdh}</strong>strong></div>div>
                                                                      <div className="detail"><span>PDL</span>span><strong>${selectedRow.pdl}</strong>strong></div>div>
                                                      </div>div>
                                        </div>div>
                            </section>section>
                          )}
                  
                          <section className="content-grid">
                                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="card">
                                                <div className="section-title"><ShieldCheck size={18} /> Qualified setups</div>div>
                                                <div className="setup-list">
                                                      {filtered.length === 0 ? (
                                  <div className="empty-state"><h3>No qualified setups yet</h3>h3><p>Run the scan to populate the precision shortlist.</p>p></div>div>
                                ) : (
                                  filtered.map((stock) => (
                                                          <button key={stock.ticker} className={"setup-card selectable-card" + (selectedTicker === stock.ticker ? " selected-card" : "")} onClick={() => { setSelectedTicker(stock.ticker); setContractSide(stock.bias === "Puts" ? "puts" : "calls"); }}>
                                                                              <div className="setup-top">
                                                                                                    <div>
                                                                                                                            <div className="ticker-row">
                                                                                                                                                      <h3>{stock.ticker}</h3>h3>
                                                                                                                                                      <span className={biasClass(stock.bias)}>{stock.bias}</span>span>
                                                                                                                                                      <span className={qualityClass(stock.setupQuality)}>{stock.setupQuality}</span>span>
                                                                                                                                                      <span className={timingClass(stock.timingState)}><span className="timing-dot"></span>span>{stock.timingState}</span>span>
                                                                                                                                                      <span className="pill">{stock.liquidityContext}</span>span>
                                                                                                                                                      <span className="pill">{stock.sessionLabel}</span>span>
                                                                                                                                                      <SignalBadge signal={stock.entrySignal} />
                                                                                                                                  </div>div>
                                                                                                                            <p className="meta">{stock.reason}</p>p>
                                                                                                          </div>div>
                                                                                                    <div className="score-grid">
                                                                                                                            <div className={scoreClass(stock.bestScore)}><span>Setup</span>span><strong>{stock.bestScore}</strong>strong></div>div>
                                                                                                                            <div className={scoreClass(stock.finalTradeScore)}><span>Trade</span>span><strong>{stock.finalTradeScore}</strong>strong></div>div>
                                                                                                                            <div className={scoreClass(stock.liquidityScore)}><span>Liquidity</span>span><strong>{stock.liquidityScore}</strong>strong></div>div>
                                                                                                                            <div className={scoreClass(stock.displacementScore)}><span>Displacement</span>span><strong>{stock.displacementScore}</strong>strong></div>div>
                                                                                                          </div>div>
                                                                              </div>div>
                                                                              <button className="journal-button" onClick={(e) => { e.stopPropagation(); saveToJournal(stock); }}>Save to Journal</button>button>
                                                          </button>button>
                                                        ))
                                )}
                                                </div>div>
                                    </motion.div>motion.div>
                          
                                    <div className="right-rail">
                                                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="card">
                                                              <div className="section-title"><Target size={18} /> Best contracts today</div>div>
                                                              <div className="rail-list">
                                                                    {bestContracts.length === 0 ? (
                                    <div className="note">Select a setup and load contracts to see the top picks.</div>div>
                                  ) : (
                                    bestContracts.map((c, idx) => (
                                                              <div key={c.symbol} className="rail-item rail-item-column">
                                                                                    <div><strong>#{idx + 1} {c.symbol}</strong>strong><span>{c.expiration} Strike {fmt(c.strike)}</span>span></div>div>
                                                                                    <div className="mini-metrics"><span>Score {c.contractScore}</span>span><span>D {fmt(c.delta, 3)}</span>span><span>Spread {fmt(c.spreadPct)}%</span>span></div>div>
                                                              </div>div>
                                                            ))
                                  )}
                                                              </div>div>
                                                </motion.div>motion.div>
                                    
                                                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }} className="card">
                                                              <div className="section-title"><Clock3 size={18} /> Contract filter</div>div>
                                                              <div className="contract-toolbar compact-toolbar">
                                                                              <div className="field">
                                                                                                <label>Selected ticker</label>label>
                                                                                                <select value={selectedTicker} onChange={(e) => setSelectedTicker(e.target.value)}>
                                                                                                                    <option value="">Pick a ticker</option>option>
                                                                                                      {rows.map((row) => <option key={row.ticker} value={row.ticker}>{row.ticker}</option>option>)}
                                                                                                      </select>select>
                                                                              </div>div>
                                                                              <div className="field">
                                                                                                <label>Contract side</label>label>
                                                                                                <select value={contractSide} onChange={(e) => setContractSide(e.target.value)}>
                                                                                                                    <option value="calls">Calls</option>option>
                                                                                                                    <option value="puts">Puts</option>option>
                                                                                                      </select>select>
                                                                              </div>div>
                                                                              <div className="field"><label>Min vol</label>label><input type="number" value={minVolume} onChange={(e) => setMinVolume(Number(e.target.value || 0))} /></div>div>
                                                                              <div className="field"><label>Min OI</label>label><input type="number" value={minOpenInterest} onChange={(e) => setMinOpenInterest(Number(e.target.value || 0))} /></div>div>
                                                                              <div className="field"><label>Max spread %</label>label><input type="number" step="0.5" value={maxSpreadPct} onChange={(e) => setMaxSpreadPct(Number(e.target.value || 0))} /></div>div>
                                                                              <div className="field"><label>Min delta</label>label><input type="number" step="0.05" value={minDeltaAbs} onChange={(e) => setMinDeltaAbs(Number(e.target.value || 0))} /></div>div>
                                                                              <div className="field"><label>Max delta</label>label><input type="number" step="0.05" value={maxDeltaAbs} onChange={(e) => setMaxDeltaAbs(Number(e.target.value || 0))} /></div>div>
                                                                              <div className="field"><label>Nearest exps</label>label><input type="number" min="1" max="6" value={maxExpirations} onChange={(e) => setMaxExpirations(Number(e.target.value || 1))} /></div>div>
                                                                              <div className="field action-field">
                                                                                                <label>Load contracts</label>label>
                                                                                                <button className="run-button" onClick={() => loadContracts()} disabled={contractStatus === "loading"}>
                                                                                                                    <RefreshCw size={16} className={contractStatus === "loading" ? "spin" : ""} />
                                                                                                      {contractStatus === "loading" ? "Loading..." : "Load"}
                                                                                                      </button>button>
                                                                              </div>div>
                                                              </div>div>
                                                      {contractMeta && (
                                  <div className="chips padded">
                                                    <span className="pill">{contractMeta.symbol}</span>span>
                                                    <span className="pill">{contractMeta.side}</span>span>
                                                    <span className="pill">Underlying {fmt(contractMeta.underlyingPrice)}</span>span>
                                        {contractMeta.expirationsUsed.map((exp) => <span key={exp} className="pill">{exp}</span>span>)}
                                  </div>div>
                                                              )}
                                                      {contractStatus === "error" && (<div className="error-box padded"><AlertCircle size={16} /><span>{contractError}</span>span></div>div>)}
                                                </motion.div>motion.div>
                                    </div>div>
                          </section>section>
                  
                          <section className="card contract-panel">
                                    <div className="section-title"><Shapes size={18} /> Contract table</div>div>
                                {contracts.length === 0 ? (
                              <div className="empty-state contract-empty"><h3>No contracts loaded</h3>h3><p>Pick a setup and load contracts to see ranked options.</p>p></div>div>
                            ) : (
                              <div className="table-wrap">
                                            <table className="contract-table">
                                                            <thead><tr><th>Rank</th>th><th>Symbol</th>th><th>Exp</th>th><th>Strike</th>th><th>Bid</th>th><th>Ask</th>th><th>Spread %</th>th><th>Volume</th>th><th>Open Int</th>th><th>Delta</th>th><th>IV</th>th><th>Score</th>th></tr>tr></thead>thead>
                                                            <tbody>
                                                                  {contracts.map((item, idx) => (
                                                        <tr key={item.symbol}>
                                                                              <td>{idx + 1}</td>td><td className="mono">{item.symbol}</td>td><td>{item.expiration}</td>td>
                                                                              <td>{fmt(item.strike)}</td>td><td>{fmt(item.bid)}</td>td><td>{fmt(item.ask)}</td>td>
                                                                              <td>{fmt(item.spreadPct)}</td>td><td>{item.volume}</td>td><td>{item.openInterest}</td>td>
                                                                              <td>{fmt(item.delta, 3)}</td>td><td>{fmt(item.iv, 3)}</td>td>
                                                                              <td><span className={scoreClass(item.contractScore)}>{item.contractScore}</span>span></td>td>
                                                        </tr>tr>
                                                      ))}
                                                            </tbody>tbody>
                                            </table>table>
                              </div>div>
                                    )}
                          </section>section>
                  
                          <section className="card contract-panel">
                                    <div className="section-title">Backtesting Journal</div>div>
                                    <div className="journal-stats">
                                                <div className="mini-stat"><span>Total Entries</span>span><strong>{journal.length}</strong>strong></div>div>
                                                <div className="mini-stat"><span>Trades Taken</span>span><strong>{journal.filter((j) => j.tradeTaken === "Yes").length}</strong>strong></div>div>
                                                <div className="mini-stat"><span>Wins</span>span><strong>{journal.filter((j) => j.outcome === "Win").length}</strong>strong></div>div>
                                                <div className="mini-stat"><span>READY Signals</span>span><strong>{journal.filter((j) => j.entrySignal === "READY").length}</strong>strong></div>div>
                                    </div>div>
                                {journal.length === 0 ? (
                              <div className="empty-state contract-empty"><h3>No journal entries yet</h3>h3><p>Save setups from the scanner to start tracking what works.</p>p></div>div>
                            ) : (
                              <div className="table-wrap">
                                            <table className="contract-table">
                                                            <thead><tr><th>Date</th>th><th>Ticker</th>th><th>Bias</th>th><th>Quality</th>th><th>Signal</th>th><th>Trade Score</th>th><th>Trade Taken</th>th><th>Outcome</th>th><th>Notes</th>th><th>Delete</th>th></tr>tr></thead>thead>
                                                            <tbody>
                                                                  {journal.map((entry) => (
                                                        <tr key={entry.id}>
                                                                              <td>{entry.date}</td>td>
                                                                              <td>{entry.ticker}</td>td>
                                                                              <td>{entry.bias}</td>td>
                                                                              <td>{entry.setupQuality}</td>td>
                                                                              <td><SignalBadge signal={entry.entrySignal} /></td>td>
                                                                              <td>{entry.finalTradeScore}</td>td>
                                                                              <td>
                                                                                                      <select value={entry.tradeTaken} onChange={(e) => updateJournalEntry(entry.id, "tradeTaken", e.target.value)}>
                                                                                                                                <option value="No">No</option>option>
                                                                                                                                <option value="Yes">Yes</option>option>
                                                                                                            </select>select>
                                                                                    </td>td>
                                                                              <td>
                                                                                                      <select value={entry.outcome} onChange={(e) => updateJournalEntry(entry.id, "outcome", e.target.value)}>
                                                                                                                                <option value="">Select</option>option>
                                                                                                                                <option value="Win">Win</option>option>
                                                                                                                                <option value="Loss">Loss</option>option>
                                                                                                                                <option value="Breakeven">Breakeven</option>option>
                                                                                                                                <option value="No Trade">No Trade</option>option>
                                                                                                            </select>select>
                                                                                    </td>td>
                                                                              <td><input type="text" value={entry.notes} onChange={(e) => updateJournalEntry(entry.id, "notes", e.target.value)} placeholder="Add notes" /></td>td>
                                                                              <td><button className="delete-button" onClick={() => deleteJournalEntry(entry.id)}>X</button>button></td>td>
                                                        </tr>tr>
                                                      ))}
                                                            </tbody>tbody>
                                            </table>table>
                              </div>div>
                                    )}
                          </section>section>
                  </div>div>
            </div>div>
          );
}</div>
