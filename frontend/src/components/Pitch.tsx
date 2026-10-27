/** Pitch markings for a 105 x 68 m SVG pitch (viewBox -3 -3 111 74). Colours come from the theme in index.css. */
export function PitchLines() {
  return (
    <g>
      <rect className="pitch-grass" x={-3} y={-3} width={111} height={74} />
      {Array.from({ length: 10 }, (_, i) => (
        <rect key={i} className={i % 2 ? 'pitch-stripe' : 'pitch-grass'} x={i * 10.5} y={0} width={10.5} height={68} />
      ))}
      <g className="pitch-markings">
        <rect x={0} y={0} width={105} height={68} />
        <line x1={52.5} y1={0} x2={52.5} y2={68} />
        <circle cx={52.5} cy={34} r={9.15} />
        <rect x={0} y={13.84} width={16.5} height={40.32} />
        <rect x={88.5} y={13.84} width={16.5} height={40.32} />
        <rect x={0} y={24.84} width={5.5} height={18.32} />
        <rect x={99.5} y={24.84} width={5.5} height={18.32} />
        <path d="M 16.5 26.7 A 9.15 9.15 0 0 1 16.5 41.3" />
        <path d="M 88.5 26.7 A 9.15 9.15 0 0 0 88.5 41.3" />
        <rect x={-1.6} y={30.34} width={1.6} height={7.32} />
        <rect x={105} y={30.34} width={1.6} height={7.32} />
      </g>
      <circle className="pitch-spot" cx={52.5} cy={34} r={0.35} />
    </g>
  )
}
