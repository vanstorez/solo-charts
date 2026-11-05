export function Sparkline({
  values,
  width = 160,
  height = 46,
  color = "var(--accent)"
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
  color?: string;
}) {
  const clean = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (clean.length < 2) {
    return <div className="sparkline-empty" style={{ width, height }} />;
  }
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const points = clean
    .map((value, index) => {
      const x = (index / (clean.length - 1)) * width;
      const y = height - ((value - min) / span) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = points.split(" ").at(-1)?.split(",") ?? ["0", "0"];
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline fill="none" stroke={color} strokeWidth="1.8" points={points} />
      <circle cx={last[0]} cy={last[1]} r="2.4" fill={color} />
    </svg>
  );
}
