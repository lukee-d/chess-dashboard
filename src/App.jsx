import { useState, useEffect, useRef } from "react";
import * as d3 from "d3";

// ═══════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════
const DEFAULT_USERNAME = "lukedoudna";

// ═══════════════════════════════════════════════════════════
// API LAYER
// ═══════════════════════════════════════════════════════════
const API = "https://api.chess.com/pub";

async function apiFetch(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

async function loadAllData(username) {
  const [stats, puzzle, archiveList] = await Promise.all([
    apiFetch(`${API}/player/${username}/stats`),
    apiFetch(`${API}/puzzle`),
    apiFetch(`${API}/player/${username}/games/archives`),
  ]);
  const urls = (archiveList.archives || []).slice(-3);
  let games = [];
  for (const u of urls) {
    try {
      const d = await apiFetch(u);
      games.push(...(d.games || []));
    } catch (_) {}
  }
  return { stats, puzzle, games };
}

// ═══════════════════════════════════════════════════════════
// MOCK DATA (for preview when API is unreachable)
// ═══════════════════════════════════════════════════════════
function mockData() {
  const openings = [
    "Italian Game","Sicilian Defense","Queen's Gambit","King's Indian",
    "Caro-Kann","French Defense","Ruy Lopez","London System",
    "Scandinavian","Pirc Defense","English Opening","Dutch Defense",
  ];
  const now = Date.now() / 1000;
  const games = [];
  let rating = 780;
  for (let i = 0; i < 50; i++) {
    const r = Math.random();
    const result = r < 0.45 ? "win" : r < 0.85 ? "checkmated" : "stalemate";
    if (result === "win") rating += Math.floor(Math.random() * 12);
    else if (result === "checkmated") rating -= Math.floor(Math.random() * 10);
    const isW = Math.random() > 0.5;
    const opp = rating + Math.floor(Math.random() * 160) - 80;
    const op = openings[Math.floor(Math.random() * openings.length)];
    games.push({
      url: `https://chess.com/game/live/${1000+i}`, time_class: "blitz",
      end_time: now - (50 - i) * 43200,
      white: { username: isW ? DEFAULT_USERNAME : `opp_${i}`, rating: isW ? rating : opp, result: isW ? result : (result==="win"?"checkmated":result==="checkmated"?"win":result) },
      black: { username: isW ? `opp_${i}` : DEFAULT_USERNAME, rating: isW ? opp : rating, result: !isW ? result : (result==="win"?"checkmated":result==="checkmated"?"win":result) },
      pgn: `[Opening "${op}"]\n1. e4 e5`,
    });
  }
  return {
    stats: {
      chess_blitz: { last: { rating, date: now }, best: { rating: rating + 30, date: now - 86400*10 }, record: { win: 48, loss: 44, draw: 8 } },
      chess_rapid: { last: { rating: rating + 80, date: now }, best: { rating: rating + 120, date: now - 86400*5 }, record: { win: 20, loss: 16, draw: 4 } },
      chess_bullet: { last: { rating: rating - 60, date: now }, best: { rating: rating - 20, date: now - 86400*15 }, record: { win: 10, loss: 14, draw: 1 } },
    },
    puzzle: {
      title: "Discovered Attack",
      url: "https://www.chess.com/daily-chess-puzzle",
      image: "https://www.chess.com/dynboard?fen=r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR&size=3",
    },
    games,
  };
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
const WINS = new Set(["win"]);
const LOSSES = new Set(["checkmated","timeout","resigned","lose","abandoned"]);

function result(g, u) {
  const isW = g.white.username.toLowerCase() === u.toLowerCase();
  const r = isW ? g.white.result : g.black.result;
  return WINS.has(r) ? "win" : LOSSES.has(r) ? "loss" : "draw";
}
function myRating(g, u) {
  return g.white.username.toLowerCase() === u.toLowerCase() ? g.white.rating : g.black.rating;
}
function oppRating(g, u) {
  return g.white.username.toLowerCase() === u.toLowerCase() ? g.black.rating : g.white.rating;
}
function oppName(g, u) {
  return g.white.username.toLowerCase() === u.toLowerCase() ? g.black.username : g.white.username;
}
function myColor(g, u) {
  return g.white.username.toLowerCase() === u.toLowerCase() ? "white" : "black";
}
function opening(pgn) {
  if (!pgn) return null;
  // Try the Opening tag first
  const m = pgn.match(/\[Opening\s+"([^"]+)"\]/);
  if (m) return m[1];
  // Chess.com often stores it in ECOUrl instead, like:
  // [ECOUrl "https://www.chess.com/openings/Kings-Pawn-Opening"]
  const eco = pgn.match(/\[ECOUrl\s+"https:\/\/www\.chess\.com\/openings\/([^"]+)"\]/);
  if (eco) return eco[1].replace(/-/g, " ").replace(/\.\.\./g, "...");
  return null;
}

// ═══════════════════════════════════════════════════════════
// RATING CHART (D3)
// ═══════════════════════════════════════════════════════════
function RatingChart({ games, username, tc = "blitz" }) {
  const svgRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!games.length || !svgRef.current) return;
    const filtered = games.filter(g => g.time_class === tc).sort((a,b) => a.end_time - b.end_time);
    if (!filtered.length) return;

    const data = filtered.map((g, i) => ({
      i, rating: myRating(g, username), res: result(g, username),
      date: new Date(g.end_time * 1000),
    }));

    const W = wrapRef.current.clientWidth, H = 200;
    const m = { t: 14, r: 14, b: 26, l: 42 };
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", W).attr("height", H);

    const x = d3.scaleLinear().domain([0, data.length - 1]).range([m.l, W - m.r]);
    const ext = d3.extent(data, d => d.rating);
    const pad = Math.max(20, (ext[1] - ext[0]) * 0.18);
    const y = d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).range([H - m.b, m.t]);

    const ticks = y.ticks(5);
    svg.append("g").selectAll("line").data(ticks).join("line")
      .attr("x1", m.l).attr("x2", W - m.r)
      .attr("y1", d => y(d)).attr("y2", d => y(d))
      .attr("stroke", "#1e1e1e").attr("stroke-dasharray", "2,5");
    svg.append("g").selectAll("text").data(ticks).join("text")
      .attr("x", m.l - 6).attr("y", d => y(d) + 4)
      .attr("text-anchor", "end").attr("fill", "#555")
      .attr("font-size", "10px").attr("font-family", "'DM Mono', monospace")
      .text(d => d);

    // Area
    const area = d3.area().x(d => x(d.i)).y0(H - m.b).y1(d => y(d.rating)).curve(d3.curveMonotoneX);
    const grad = svg.append("defs").append("linearGradient").attr("id", "ag").attr("x1","0").attr("x2","0").attr("y1","0").attr("y2","1");
    grad.append("stop").attr("offset","0%").attr("stop-color","#c89b3c").attr("stop-opacity",0.2);
    grad.append("stop").attr("offset","100%").attr("stop-color","#c89b3c").attr("stop-opacity",0.01);
    svg.append("path").datum(data).attr("d", area).attr("fill", "url(#ag)");

    // Line
    const line = d3.line().x(d => x(d.i)).y(d => y(d.rating)).curve(d3.curveMonotoneX);
    svg.append("path").datum(data).attr("d", line).attr("fill","none").attr("stroke","#c89b3c").attr("stroke-width",2);

    // Dots
    svg.append("g").selectAll("circle").data(data).join("circle")
      .attr("cx", d => x(d.i)).attr("cy", d => y(d.rating)).attr("r", 2.5)
      .attr("fill", d => d.res === "win" ? "#4ade80" : d.res === "loss" ? "#f87171" : "#666")
      .attr("stroke", "#0d0d0d").attr("stroke-width", 1);

    // Current label
    const last = data[data.length - 1];
    svg.append("text").attr("x", x(last.i)).attr("y", y(last.rating) - 10)
      .attr("text-anchor","middle").attr("fill","#c89b3c")
      .attr("font-size","12px").attr("font-weight","700")
      .attr("font-family","'DM Mono', monospace").text(last.rating);
  }, [games, username, tc]);

  return <div ref={wrapRef} style={{width:"100%"}}><svg ref={svgRef} style={{display:"block"}} /></div>;
}

// ═══════════════════════════════════════════════════════════
// SUB COMPONENTS
// ═══════════════════════════════════════════════════════════
function Stat({ label, value, sub, color }) {
  return (
    <div style={s.stat}>
      <div style={{...s.statVal, color: color || "#c89b3c"}}>{value}</div>
      <div style={s.statLbl}>{label}</div>
      {sub && <div style={s.statSub}>{sub}</div>}
    </div>
  );
}

function RecentGames({ games, u, tc = "blitz" }) {
  const recent = games.filter(g => g.time_class === tc).sort((a,b) => b.end_time - a.end_time).slice(0, 10);
  return (
    <div style={s.panel}>
      <h2 style={s.panelH}>Recent Games</h2>
      <div style={s.gList}>
        {recent.map((g, i) => {
          const res = result(g, u), oR = oppRating(g, u), oN = oppName(g, u);
          const col = myColor(g, u), op = opening(g.pgn);
          const rc = res === "win" ? "#4ade80" : res === "loss" ? "#f87171" : "#666";
          const rl = res === "win" ? "W" : res === "loss" ? "L" : "D";
          return (
            <a key={i} href={g.url} target="_blank" rel="noopener noreferrer"
              style={{...s.gRow, borderLeft: `3px solid ${rc}`, animationDelay: `${i*50}ms`}}
              onMouseEnter={e => e.currentTarget.style.background = "#181818"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <div style={{...s.gBadge, background: rc+"18", color: rc}}>{rl}</div>
              <div style={{flex:1, minWidth:0}}>
                <div style={s.gOpp}>
                  <span style={{color: col==="white"?"#ddd":"#666", marginRight:5, fontSize:10}}>{col==="white"?"♔":"♚"}</span>
                  vs {oN} <span style={s.gOppR}>({oR})</span>
                </div>
                {op && <div style={s.gOpen}>{op}</div>}
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

function Openings({ games, u, tc = "blitz" }) {
  const map = {};
  games.filter(g => g.time_class === tc).forEach(g => {
    const op = opening(g.pgn), res = result(g, u);
    if (!op) return; // skip games with no opening data
    if (!map[op]) map[op] = { t: 0, w: 0, l: 0, d: 0 };
    map[op].t++; map[op][res[0]]++;
  });
  const sorted = Object.entries(map).sort((a,b) => b[1].t - a[1].t).slice(0, 7);
  const max = sorted[0]?.[1].t || 1;

  return (
    <div style={s.panel}>
      <h2 style={s.panelH}>Opening Repertoire</h2>
      <div style={{display:"flex", flexDirection:"column", gap:12}}>
        {sorted.map(([name, d], i) => {
          const wp = d.t ? Math.round((d.w / d.t) * 100) : 0;
          const bw = (d.t / max) * 100;
          return (
            <div key={name} style={{animationDelay:`${i*70}ms`, animation:"fadeUp .5s ease both"}}>
              <div style={{display:"flex", justifyContent:"space-between", marginBottom:3}}>
                <span style={{fontSize:12, color:"#bbb"}}>{name}</span>
                <span style={{fontSize:11, color:"#555"}}>{d.t} games</span>
              </div>
              <div style={s.oBar}>
                <div style={{...s.oBarFill, width:`${bw}%`}}>
                  <div style={{...s.oBarWin, width:`${wp}%`}} />
                </div>
              </div>
              <div style={{fontSize:11, color:"#555", marginTop:2}}>
                <span style={{color:"#4ade80"}}>{d.w}W</span>{" · "}
                <span style={{color:"#f87171"}}>{d.l}L</span>{" · "}
                <span style={{color:"#666"}}>{d.d}D</span>
                <span style={{float:"right", color: wp >= 50 ? "#4ade80" : "#f87171"}}>{wp}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Puzzle({ puzzle }) {
  if (!puzzle) return null;
  return (
    <div style={s.panel}>
      <h2 style={s.panelH}>Daily Puzzle</h2>
      <a href={puzzle.url} target="_blank" rel="noopener noreferrer" style={{textDecoration:"none", color:"#ccc", display:"block"}}>
        <div style={{position:"relative", borderRadius:6, overflow:"hidden", marginBottom:10, border:"1px solid #1e1e1e"}}>
          <img src={puzzle.image} alt="Puzzle" style={{width:"100%", display:"block", borderRadius:6}} />
        </div>
        <div style={{fontSize:14, fontWeight:600, color:"#e8e0d0", fontFamily:"'Cormorant Garamond', serif"}}>{puzzle.title}</div>
        <div style={{fontSize:12, color:"#c89b3c", marginTop:4}}>Solve on Chess.com →</div>
      </a>
    </div>
  );
}

function ColorPerformance({ games, u, tc = "blitz" }) {
  const filtered = games.filter(g => g.time_class === tc);
  const white = { w: 0, l: 0, d: 0, ratingDelta: 0 };
  const black = { w: 0, l: 0, d: 0, ratingDelta: 0 };

  // Sort by time to calculate rating deltas
  const sorted = [...filtered].sort((a, b) => a.end_time - b.end_time);
  for (let i = 0; i < sorted.length; i++) {
    const g = sorted[i];
    const isW = g.white.username.toLowerCase() === u.toLowerCase();
    const bucket = isW ? white : black;
    const res = result(g, u);
    bucket[res[0]]++;
    // Rating delta: compare to previous game's rating
    if (i > 0) {
      const prev = myRating(sorted[i - 1], u);
      const curr = myRating(g, u);
      bucket.ratingDelta += curr - prev;
    }
  }

  const whiteTotal = white.w + white.l + white.d;
  const blackTotal = black.w + black.l + black.d;
  const whiteWinPct = whiteTotal ? Math.round((white.w / whiteTotal) * 100) : 0;
  const blackWinPct = blackTotal ? Math.round((black.w / blackTotal) * 100) : 0;
  const gap = whiteWinPct - blackWinPct;

  function Bar({ label, icon, data, total, winPct, color }) {
    const lossPct = total ? Math.round((data.l / total) * 100) : 0;
    const drawPct = total ? 100 - winPct - lossPct : 0;
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 18 }}>{icon}</span>
            <span style={{ fontSize: 13, color: "#bbb", fontWeight: 500 }}>{label}</span>
            <span style={{ fontSize: 11, color: "#444" }}>({total} games)</span>
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'Cormorant Garamond',serif", color: winPct >= 50 ? "#4ade80" : winPct >= 45 ? "#c89b3c" : "#f87171" }}>
            {winPct}% wins
          </span>
        </div>
        <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", gap: 1 }}>
          <div style={{ width: `${winPct}%`, background: "#4ade80", borderRadius: "5px 0 0 5px", transition: "width .6s ease" }} />
          <div style={{ width: `${drawPct}%`, background: "#555", transition: "width .6s ease" }} />
          <div style={{ width: `${lossPct}%`, background: "#f87171", borderRadius: "0 5px 5px 0", transition: "width .6s ease" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#555", marginTop: 4 }}>
          <span><span style={{ color: "#4ade80" }}>{data.w}W</span> · <span style={{ color: "#f87171" }}>{data.l}L</span> · <span style={{ color: "#666" }}>{data.d}D</span></span>
          <span style={{ color: data.ratingDelta >= 0 ? "#4ade80" : "#f87171" }}>
            {data.ratingDelta >= 0 ? "+" : ""}{data.ratingDelta} rating
          </span>
        </div>
      </div>
    );
  }

  // Insight text
  let insight = "";
  if (Math.abs(gap) < 3) insight = "Your performance is balanced across both colors — no significant gap.";
  else if (gap > 0) insight = `You win ${gap} percentage points more as White. Consider studying Black openings to close the gap.`;
  else insight = `You win ${Math.abs(gap)} percentage points more as Black — unusual! Your White repertoire might need some work.`;

  return (
    <div style={s.panel}>
      <h2 style={s.panelH}>Performance by Color</h2>
      <div style={{ marginTop: 14 }}>
        <Bar label="White" icon="♔" data={white} total={whiteTotal} winPct={whiteWinPct} />
        <Bar label="Black" icon="♚" data={black} total={blackTotal} winPct={blackWinPct} />
      </div>
      <div style={{ fontSize: 12, color: "#888", marginTop: 8, padding: "10px 12px", background: "#0d0d0d", borderRadius: 4, border: "1px solid #1a1a1a", lineHeight: 1.5 }}>
        💡 {insight}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// PLAYER INSIGHTS
// ═══════════════════════════════════════════════════════════
function PlayerInsights({ games, u, tc = "blitz" }) {
  const filtered = games.filter(g => g.time_class === tc);
  if (filtered.length < 5) return null;

  const sorted = [...filtered].sort((a, b) => a.end_time - b.end_time);

  // ── Tilt Detection ──
  let afterLossGames = 0, afterLossWins = 0;
  let afterWinGames = 0, afterWinWins = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prevResult = result(sorted[i - 1], u);
    const currResult = result(sorted[i], u);
    if (prevResult === "loss") {
      afterLossGames++;
      if (currResult === "win") afterLossWins++;
    }
    if (prevResult === "win") {
      afterWinGames++;
      if (currResult === "win") afterWinWins++;
    }
  }
  const afterLossWinPct = afterLossGames ? Math.round((afterLossWins / afterLossGames) * 100) : null;
  const afterWinWinPct = afterWinGames ? Math.round((afterWinWins / afterWinGames) * 100) : null;

  let tiltInsight = "";
  if (afterLossWinPct !== null && afterWinWinPct !== null) {
    const diff = afterWinWinPct - afterLossWinPct;
    if (diff > 10) tiltInsight = `You win ${afterLossWinPct}% after a loss vs ${afterWinWinPct}% after a win — a ${diff}pt drop. Consider taking a break after losses.`;
    else if (diff > 3) tiltInsight = `Slight tilt detected: ${afterLossWinPct}% win rate after a loss vs ${afterWinWinPct}% after a win.`;
    else tiltInsight = `No significant tilt — you win ${afterLossWinPct}% after a loss vs ${afterWinWinPct}% after a win. Mentally steady.`;
  }

  // ── Time of Day ──
  const hourBuckets = {};
  const hourLabels = { morning: "Morning (6am–12pm)", afternoon: "Afternoon (12pm–6pm)", evening: "Evening (6pm–12am)", night: "Night (12am–6am)" };
  sorted.forEach(g => {
    const h = new Date(g.end_time * 1000).getHours();
    const bucket = h >= 6 && h < 12 ? "morning" : h >= 12 && h < 18 ? "afternoon" : h >= 18 ? "evening" : "night";
    if (!hourBuckets[bucket]) hourBuckets[bucket] = { total: 0, wins: 0 };
    hourBuckets[bucket].total++;
    if (result(g, u) === "win") hourBuckets[bucket].wins++;
  });

  const timeSlots = Object.entries(hourBuckets)
    .filter(([_, d]) => d.total >= 3)
    .map(([bucket, d]) => ({ bucket, label: hourLabels[bucket], total: d.total, winPct: Math.round((d.wins / d.total) * 100) }))
    .sort((a, b) => b.winPct - a.winPct);

  const bestTime = timeSlots[0];
  const worstTime = timeSlots[timeSlots.length - 1];

  // ── Rating Change Per Opening ──
  const openingRating = {};
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i];
    const op = opening(g.pgn);
    if (!op) continue;
    const delta = myRating(g, u) - myRating(sorted[i - 1], u);
    if (!openingRating[op]) openingRating[op] = { delta: 0, count: 0 };
    openingRating[op].delta += delta;
    openingRating[op].count++;
  }
  const openingSorted = Object.entries(openingRating)
    .filter(([_, d]) => d.count >= 3)
    .sort((a, b) => b[1].delta - a[1].delta);
  const bestOpening = openingSorted[0];
  const worstOpening = openingSorted[openingSorted.length - 1];

  // ── Average Game Length ──
  const winLengths = [];
  const lossLengths = [];
  sorted.forEach(g => {
    // Estimate moves from PGN — count move numbers
    const moves = g.pgn ? (g.pgn.match(/\d+\./g) || []).length : 0;
    if (moves === 0) return;
    const res = result(g, u);
    if (res === "win") winLengths.push(moves);
    else if (res === "loss") lossLengths.push(moves);
  });
  const avgWinLength = winLengths.length ? Math.round(winLengths.reduce((a, b) => a + b, 0) / winLengths.length) : null;
  const avgLossLength = lossLengths.length ? Math.round(lossLengths.reduce((a, b) => a + b, 0) / lossLengths.length) : null;

  let lengthInsight = "";
  if (avgWinLength && avgLossLength) {
    const diff = avgLossLength - avgWinLength;
    if (diff > 5) lengthInsight = `Your losses average ${avgLossLength} moves vs ${avgWinLength} for wins — you tend to lose in longer games. Endgame study could help.`;
    else if (diff < -5) lengthInsight = `Your losses average ${avgLossLength} moves vs ${avgWinLength} for wins — you're losing quickly, possibly to tactical blunders early on.`;
    else lengthInsight = `Wins average ${avgWinLength} moves, losses average ${avgLossLength} — similar length, no clear pattern.`;
  }

  function InsightRow({ icon, title, children }) {
    return (
      <div style={{ padding: "12px 0", borderBottom: "1px solid #1a1a1a" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 16 }}>{icon}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#e8e0d0", fontFamily: "'Cormorant Garamond',serif" }}>{title}</span>
        </div>
        <div style={{ fontSize: 12, color: "#888", lineHeight: 1.6, paddingLeft: 24 }}>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div style={s.panel}>
      <h2 style={s.panelH}>Player Insights</h2>

      {tiltInsight && (
        <InsightRow icon="🧠" title="Tilt Detection">
          {tiltInsight}
          <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
            <div style={{ fontSize: 11 }}>
              <span style={{ color: "#f87171" }}>After a loss:</span>{" "}
              <span style={{ color: "#ddd", fontWeight: 600 }}>{afterLossWinPct}%</span>
              <span style={{ color: "#555" }}> win rate ({afterLossGames} games)</span>
            </div>
            <div style={{ fontSize: 11 }}>
              <span style={{ color: "#4ade80" }}>After a win:</span>{" "}
              <span style={{ color: "#ddd", fontWeight: 600 }}>{afterWinWinPct}%</span>
              <span style={{ color: "#555" }}> win rate ({afterWinGames} games)</span>
            </div>
          </div>
        </InsightRow>
      )}

      {timeSlots.length > 1 && (
        <InsightRow icon="🕐" title="Performance by Time of Day">
          {bestTime && worstTime && bestTime.bucket !== worstTime.bucket
            ? `You play best in the ${bestTime.label} (${bestTime.winPct}% win rate) and worst in the ${worstTime.label} (${worstTime.winPct}%).`
            : "Not enough variation across time slots to draw conclusions."}
          <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
            {timeSlots.map(t => (
              <div key={t.bucket} style={{
                fontSize: 11, padding: "4px 10px", background: "#0d0d0d",
                border: "1px solid #1a1a1a", borderRadius: 4,
              }}>
                <span style={{ color: "#aaa" }}>{t.label.split(" (")[0]}</span>{" "}
                <span style={{ color: t.winPct >= 50 ? "#4ade80" : "#f87171", fontWeight: 600 }}>{t.winPct}%</span>
                <span style={{ color: "#444" }}> ({t.total}g)</span>
              </div>
            ))}
          </div>
        </InsightRow>
      )}

      {openingSorted.length > 0 && (
        <InsightRow icon="📖" title="Rating Change by Opening">
          {bestOpening && worstOpening ? (
            <>
              {bestOpening[1].delta > 0
                ? `Best: ${bestOpening[0]} has gained you ${bestOpening[1].delta > 0 ? "+" : ""}${bestOpening[1].delta} rating over ${bestOpening[1].count} games.`
                : `No opening has gained you rating — your best is ${bestOpening[0]} at ${bestOpening[1].delta > 0 ? "+" : ""}${bestOpening[1].delta}.`}
              {worstOpening[0] !== bestOpening[0] && (
                <> Worst: {worstOpening[0]} at {worstOpening[1].delta > 0 ? "+" : ""}{worstOpening[1].delta} over {worstOpening[1].count} games.</>
              )}
            </>
          ) : "Not enough data yet."}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
            {openingSorted.slice(0, 5).map(([name, d]) => (
              <div key={name} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "3px 0" }}>
                <span style={{ color: "#aaa" }}>{name}</span>
                <span style={{ color: d.delta >= 0 ? "#4ade80" : "#f87171", fontWeight: 600 }}>
                  {d.delta >= 0 ? "+" : ""}{d.delta} <span style={{ color: "#444", fontWeight: 400 }}>({d.count}g)</span>
                </span>
              </div>
            ))}
          </div>
        </InsightRow>
      )}

      {lengthInsight && (
        <InsightRow icon="📏" title="Average Game Length">
          {lengthInsight}
          <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
            {avgWinLength && (
              <div style={{ fontSize: 11 }}>
                <span style={{ color: "#4ade80" }}>Wins:</span>{" "}
                <span style={{ color: "#ddd", fontWeight: 600 }}>~{avgWinLength} moves</span>
              </div>
            )}
            {avgLossLength && (
              <div style={{ fontSize: 11 }}>
                <span style={{ color: "#f87171" }}>Losses:</span>{" "}
                <span style={{ color: "#ddd", fontWeight: 600 }}>~{avgLossLength} moves</span>
              </div>
            )}
          </div>
        </InsightRow>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// LANDING SCREEN
// ═══════════════════════════════════════════════════════════
function LandingScreen({ onSubmit }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  async function handleSubmit(username) {
    const name = (username || input).trim().toLowerCase();
    if (!name) return;
    setError("");
    setChecking(true);
    try {
      await apiFetch(`${API}/player/${name}`);
      onSubmit(name);
    } catch (e) {
      setError(`Player "${name}" not found on Chess.com`);
      setChecking(false);
    }
  }

  return (
    <div style={s.root}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Mono:wght@400;500&display=swap');
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        *{box-sizing:border-box;margin:0;padding:0}
      `}</style>
      <div style={s.landing}>
        <div style={s.landingInner}>
          <div style={{fontSize:48, marginBottom:8}}>♟</div>
          <h1 style={s.landingTitle}>Chess Dashboard</h1>
          <p style={s.landingDesc}>
            Enter a Chess.com username to view ratings, game history, opening repertoire, and performance analytics.
          </p>
          <div style={s.inputRow}>
            <input
              type="text"
              placeholder="Chess.com username"
              value={input}
              onChange={e => { setInput(e.target.value); setError(""); }}
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
              style={s.input}
              autoFocus
            />
            <button onClick={() => handleSubmit()} disabled={checking} style={s.goBtn}>
              {checking ? "..." : "Go"}
            </button>
          </div>
          {error && <div style={s.error}>{error}</div>}
          <div style={s.landingOr}>or try a demo</div>
          <button onClick={() => handleSubmit(DEFAULT_USERNAME)} style={s.demoBtn}>
            View {DEFAULT_USERNAME}'s dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════
export default function App() {
  const [username, setUsername] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mock, setMock] = useState(false);
  const [tc, setTc] = useState("blitz");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!username) return;
    setLoading(true);
    setLoadError("");
    setData(null);
    loadAllData(username)
      .then(d => { setData(d); setMock(false); })
      .catch(() => { setLoadError("Failed to load data. Check the username and try again."); })
      .finally(() => setLoading(false));
  }, [username]);

  if (!username) return <LandingScreen onSubmit={setUsername} />;

  if (loading) return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0d0d0d",fontFamily:"'DM Mono',monospace"}}>
      <style>{`@keyframes spin { to{transform:rotate(360deg)} }`}</style>
      <div style={{width:28,height:28,border:"2px solid #222",borderTopColor:"#c89b3c",borderRadius:"50%",animation:"spin .7s linear infinite"}} />
      <div style={{marginTop:14,color:"#555",fontSize:12}}>Loading {username}'s games...</div>
    </div>
  );

  if (loadError) return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0d0d0d",fontFamily:"'DM Mono',monospace"}}>
      <div style={{color:"#f87171",fontSize:14,marginBottom:16}}>{loadError}</div>
      <button onClick={() => setUsername(null)}
        style={{...s.goBtn, padding:"8px 20px"}}>
        ← Try another username
      </button>
    </div>
  );

  if (!data) return null;

  const { stats, puzzle, games } = data;
  const tcKey = `chess_${tc}`;
  const activeStat = stats?.[tcKey];

  const filtered = games.filter(g => g.time_class === tc);
  const w = filtered.filter(g => result(g, username) === "win").length;
  const l = filtered.filter(g => result(g, username) === "loss").length;
  const d = filtered.filter(g => result(g, username) === "draw").length;

  const sorted = [...filtered].sort((a,b) => b.end_time - a.end_time);
  let streak = 0, sType = null;
  for (const g of sorted) {
    const r = result(g, username);
    if (!sType) sType = r;
    if (r === sType) streak++; else break;
  }
  const sLabel = sType === "win" ? `${streak}W streak 🔥` : sType === "loss" ? `${streak}L streak` : sType ? `${streak} draws` : "";

  const tcLabel = tc.charAt(0).toUpperCase() + tc.slice(1);
  const tcOptions = ["blitz", "rapid", "bullet"];

  return (
    <div style={s.root}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Mono:wght@400;500&display=swap');
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:#2a2a2a;border-radius:3px}::-webkit-scrollbar-track{background:transparent}
      `}</style>

      <header style={s.header}>
        <div style={s.headerIn}>
          <div>
            <h1 style={s.title}><span style={{color:"#c89b3c",fontSize:24}}>♟</span> {username}</h1>
            <p style={s.sub}>{tcLabel} Dashboard</p>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={s.tcToggle}>
              {tcOptions.map(opt => (
                <button key={opt} onClick={() => setTc(opt)}
                  style={{...s.tcBtn, ...(tc === opt ? s.tcBtnActive : {})}}>
                  {opt.charAt(0).toUpperCase() + opt.slice(1)}
                </button>
              ))}
            </div>
            {mock && <div style={s.mockTag}>Preview — mock data</div>}
            <button onClick={() => { setUsername(null); setData(null); setTc("blitz"); }}
              style={s.changeBtn}>
              Change Player
            </button>
            <a href={`https://chess.com/member/${username}`} target="_blank" rel="noopener noreferrer"
              style={{fontSize:12, color:"#c89b3c", textDecoration:"none", border:"1px solid #c89b3c33", padding:"5px 12px", borderRadius:4}}>
              Chess.com Profile →
            </a>
          </div>
        </div>
      </header>

      <div style={s.content}>
        <div style={s.statsRow}>
          <Stat label={`${tcLabel} Rating`} value={activeStat?.last?.rating || "—"} sub={`Peak: ${activeStat?.best?.rating || "—"}`} />
          <Stat label={`${tcLabel} Record`} value={`${w}W · ${l}L · ${d}D`} sub={sLabel}
            color={sType==="win"?"#4ade80":sType==="loss"?"#f87171":"#666"} />
          <Stat label="Games Analyzed" value={filtered.length} sub={`Last ${Math.min(3, Math.ceil(filtered.length / 30))} months`} />
        </div>

        <div style={{...s.panel, marginTop:16}}>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10}}>
            <h2 style={s.panelH}>{tcLabel} Rating History</h2>
            <div style={{display:"flex",gap:14,fontSize:11,color:"#555"}}>
              <span><span style={{color:"#4ade80"}}>●</span> Win</span>
              <span><span style={{color:"#f87171"}}>●</span> Loss</span>
              <span><span style={{color:"#666"}}>●</span> Draw</span>
            </div>
          </div>
          <RatingChart games={games} username={username} tc={tc} />
        </div>

        <div style={s.grid}>
          <RecentGames games={games} u={username} tc={tc} />
          <Openings games={games} u={username} tc={tc} />
          <Puzzle puzzle={puzzle} />
        </div>

        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <ColorPerformance games={games} u={username} tc={tc} />
          <PlayerInsights games={games} u={username} tc={tc} />
        </div>
      </div>

      <footer style={s.footer}>
        Data from Chess.com Public API
      </footer>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════
const s = {
  root: { fontFamily:"'DM Mono',monospace", background:"#0d0d0d", color:"#ccc", minHeight:"100vh" },
  header: { background:"linear-gradient(180deg,#131313,#0d0d0d)", borderBottom:"1px solid #1a1a1a", padding:"24px 28px 18px" },
  headerIn: { maxWidth:1100, margin:"0 auto", display:"flex", justifyContent:"space-between", alignItems:"flex-end" },
  title: { fontFamily:"'Cormorant Garamond',serif", fontSize:28, fontWeight:700, color:"#e8e0d0", display:"flex", alignItems:"center", gap:8 },
  sub: { fontSize:11, color:"#555", marginTop:3, letterSpacing:"2px", textTransform:"uppercase" },
  mockTag: { fontSize:10, color:"#c89b3c", background:"#c89b3c0e", border:"1px solid #c89b3c22", borderRadius:3, padding:"3px 8px" },
  content: { maxWidth:1100, margin:"0 auto", padding:"20px 28px" },
  statsRow: { display:"flex", gap:12, flexWrap:"wrap" },
  stat: { background:"#111", border:"1px solid #1a1a1a", borderRadius:6, padding:"14px 20px", flex:"1 1 150px", animation:"fadeUp .45s ease both" },
  statVal: { fontSize:24, fontWeight:700, fontFamily:"'Cormorant Garamond',serif", lineHeight:1 },
  statLbl: { fontSize:10, color:"#555", textTransform:"uppercase", letterSpacing:"1.5px", marginTop:5 },
  statSub: { fontSize:11, color:"#444", marginTop:3 },
  panel: { background:"#111", border:"1px solid #1a1a1a", borderRadius:6, padding:18, animation:"fadeUp .5s ease both" },
  panelH: { fontFamily:"'Cormorant Garamond',serif", fontSize:17, fontWeight:600, color:"#e8e0d0", marginBottom:0, letterSpacing:".3px" },
  grid: { display:"grid",gridTemplateColumns:"1fr 1fr 260px",gap:14,marginTop:16 },
  gList: { display:"flex", flexDirection:"column", gap:3, maxHeight:400, overflowY:"auto", marginTop:12 },
  gRow: { display:"flex", alignItems:"center", gap:8, padding:"7px 8px", borderRadius:3, textDecoration:"none", color:"#ccc", transition:"background .12s", animation:"fadeUp .4s ease both" },
  gBadge: { width:26, height:26, borderRadius:3, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, flexShrink:0 },
  gOpp: { fontSize:12, fontWeight:500, color:"#ddd", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" },
  gOppR: { color:"#555", fontSize:10, marginLeft:3 },
  gOpen: { fontSize:10, color:"#444", marginTop:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" },
  oBar: { height:7, background:"#1a1a1a", borderRadius:4, overflow:"hidden" },
  oBarFill: { height:"100%", background:"#282828", borderRadius:4, position:"relative", overflow:"hidden", transition:"width .6s ease" },
  oBarWin: { position:"absolute", top:0, left:0, height:"100%", background:"#4ade8044", borderRadius:4 },
  footer: { maxWidth:1100, margin:"28px auto 0", padding:"14px 28px", borderTop:"1px solid #1a1a1a", fontSize:10, color:"#333", textAlign:"center" },
  tcToggle: { display:"flex", background:"#0d0d0d", border:"1px solid #1a1a1a", borderRadius:5, overflow:"hidden" },
  tcBtn: {
    background:"transparent", border:"none", color:"#555", fontSize:11, fontFamily:"'DM Mono',monospace",
    padding:"5px 14px", cursor:"pointer", transition:"all .15s", letterSpacing:"0.5px",
  },
  tcBtnActive: {
    background:"#c89b3c18", color:"#c89b3c", borderBottom:"none",
  },
  // Landing screen
  landing: {
    display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh",
    background:"radial-gradient(ellipse at 50% 40%, #141414 0%, #0d0d0d 70%)",
  },
  landingInner: {
    textAlign:"center", maxWidth:420, padding:"0 24px", animation:"fadeUp .6s ease both",
  },
  landingTitle: {
    fontFamily:"'Cormorant Garamond',serif", fontSize:36, fontWeight:700, color:"#e8e0d0",
    letterSpacing:"-0.5px", marginBottom:10,
  },
  landingDesc: {
    fontSize:13, color:"#666", lineHeight:1.6, marginBottom:28,
  },
  inputRow: {
    display:"flex", gap:8, marginBottom:10,
  },
  input: {
    flex:1, background:"#111", border:"1px solid #1a1a1a", borderRadius:5,
    padding:"10px 14px", color:"#ddd", fontSize:14, fontFamily:"'DM Mono',monospace",
    outline:"none",
  },
  goBtn: {
    background:"#c89b3c", color:"#0d0d0d", border:"none", borderRadius:5,
    padding:"10px 20px", fontSize:13, fontWeight:700, fontFamily:"'DM Mono',monospace",
    cursor:"pointer", letterSpacing:"0.5px",
  },
  error: {
    color:"#f87171", fontSize:12, marginTop:8, marginBottom:4,
  },
  landingOr: {
    fontSize:11, color:"#444", margin:"20px 0 12px", textTransform:"uppercase", letterSpacing:"2px",
  },
  demoBtn: {
    background:"transparent", border:"1px solid #1a1a1a", borderRadius:5,
    padding:"8px 18px", color:"#888", fontSize:12, fontFamily:"'DM Mono',monospace",
    cursor:"pointer", transition:"all .15s",
  },
  changeBtn: {
    fontSize:12, color:"#888", background:"transparent", border:"1px solid #1a1a1a",
    padding:"5px 12px", borderRadius:4, cursor:"pointer", fontFamily:"'DM Mono',monospace",
  },
};