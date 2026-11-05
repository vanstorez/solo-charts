export function EquityCurve({ points, height = 220 }: { points: { date: string; equity: number }[]; height?: number }) {
  if (points.length < 2) {
    return <div className="chart-empty" style={{ minHeight: height }}>Not enough closed-trade points to draw an equity curve.</div>;
  }
  const width = 760;
  const values = points.map((point) => point.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 18;
  const path = points
    .map((point, index) => {
      const x = pad + (index / (points.length - 1)) * (width - pad * 2);
      const y = height - pad - ((point.equity - min) / span) * (height - pad * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div className="table-scroll">
      <svg role="img" aria-label="Closed-trade equity curve" viewBox={`0 0 ${width} ${height}`} style={{ display: "block", width: "100%", minWidth: 420 }}>
        <defs>
          <linearGradient id="equityFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(110,168,255,0.18)" />
            <stop offset="100%" stopColor="rgba(110,168,255,0)" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            stroke="rgba(21,50,66,0.55)"
            strokeDasharray="2 4"
            x1={pad}
            x2={width - pad}
            y1={pad + fraction * (height - pad * 2)}
            y2={pad + fraction * (height - pad * 2)}
          />
        ))}
        <path d={`${path} L${width - pad},${height - pad} L${pad},${height - pad} Z`} fill="url(#equityFill)" />
        <path d={path} fill="none" stroke="#6ea8ff" strokeWidth="1.8" />
        <text fill="#5e7785" fontFamily="monospace" fontSize="8" x={pad} y={12}>₹{Math.round(max).toLocaleString("en-IN")}</text>
        <text fill="#5e7785" fontFamily="monospace" fontSize="8" x={pad} y={height - 4}>₹{Math.round(min).toLocaleString("en-IN")}</text>
        <text fill="#5e7785" fontFamily="monospace" fontSize="8" textAnchor="end" x={width - pad} y={height - 4}>{points[0].date}</text>
        <text fill="#5e7785" fontFamily="monospace" fontSize="8" textAnchor="end" x={width - pad} y={12}>{points.at(-1)?.date}</text>
      </svg>
    </div>
  );
}
