// Nutria institucional (boceto provisional: el diseño definitivo está pendiente).
export function Mascot({ size = 180 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label="Mascota de ANTROPNUTRI: nutria atlética">
      <defs>
        <linearGradient id="fur" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#b07d52" /><stop offset="1" stopColor="#8a5a3b" />
        </linearGradient>
      </defs>
      {/* cuerpo y hombros */}
      <path d="M40 200 C40 150 60 128 100 128 C140 128 160 150 160 200 Z" fill="url(#fur)" />
      <path d="M72 200 C74 165 86 150 100 150 C114 150 126 165 128 200 Z" fill="#f3e9dc" />
      {/* brazos flexionados */}
      <path d="M44 168 C22 160 18 132 30 112 C36 102 50 104 52 114 C54 124 46 132 50 146 Z" fill="url(#fur)" />
      <ellipse cx="36" cy="112" rx="13" ry="12" fill="#8a5a3b" />
      <path d="M156 168 C178 160 182 132 170 112 C164 102 150 104 148 114 C146 124 154 132 150 146 Z" fill="url(#fur)" />
      <ellipse cx="164" cy="112" rx="13" ry="12" fill="#8a5a3b" />
      {/* cinta métrica */}
      <path d="M66 176 Q100 186 134 176" stroke="#e9c46a" strokeWidth="7" fill="none" strokeLinecap="round" />
      {[74, 86, 98, 110, 122].map((x) => <line key={x} x1={x} y1={178} x2={x} y2={183} stroke="#5b3a29" strokeWidth="1.5" />)}
      {/* cabeza */}
      <circle cx="64" cy="52" r="13" fill="#8a5a3b" /><circle cx="136" cy="52" r="13" fill="#8a5a3b" />
      <circle cx="64" cy="52" r="6" fill="#5b3a29" /><circle cx="136" cy="52" r="6" fill="#5b3a29" />
      <ellipse cx="100" cy="80" rx="44" ry="40" fill="url(#fur)" />
      <ellipse cx="100" cy="96" rx="27" ry="20" fill="#f3e9dc" />
      <circle cx="83" cy="74" r="5.5" fill="#2b1a10" /><circle cx="117" cy="74" r="5.5" fill="#2b1a10" />
      <circle cx="85" cy="72" r="1.6" fill="#fff" /><circle cx="119" cy="72" r="1.6" fill="#fff" />
      <ellipse cx="100" cy="88" rx="8" ry="5.5" fill="#2b1a10" />
      <path d="M92 100 Q100 106 108 100" stroke="#2b1a10" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <g stroke="#5b3a29" strokeWidth="1.5" strokeLinecap="round">
        <line x1="76" y1="94" x2="58" y2="90" /><line x1="76" y1="98" x2="58" y2="100" />
        <line x1="124" y1="94" x2="142" y2="90" /><line x1="124" y1="98" x2="142" y2="100" />
      </g>
    </svg>
  )
}
