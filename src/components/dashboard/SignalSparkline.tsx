type Props = {
  values: number[]; // 12 monthly counts, oldest → newest
  width?: number;
  height?: number;
  color?: string;
};

export function SignalSparkline({ values, width = 110, height = 28, color = "#22D3EE" }: Props) {
  if (!values || values.length < 2) {
    return <div className="text-[10px] text-muted-foreground/40 font-mono">—</div>;
  }
  const max = Math.max(1, ...values);
  const stepX = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - (v / max) * (height - 2) - 1;
    return [x, y] as const;
  });
  const path = points.map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`)).join(" ");
  const area = `${path} L ${points[points.length - 1][0]} ${height} L 0 ${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
      <path d={area} fill={color} opacity={0.15} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
