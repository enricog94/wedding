import type { ThemeDecoration as Decoration, WeddingTheme } from '../lib/themes';

type DecorationSlot = keyof WeddingTheme['decorations'];

type ThemeDecorationProps = {
  theme: WeddingTheme;
  slot: DecorationSlot;
};

function decorationContent(decoration: Decoration) {
  if (decoration === 'sunflower-arc' || decoration === 'sunflower-orbit') {
    return (
      <svg className="sunflower-arc-svg" viewBox="0 0 500 500" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        {/* Asymmetrical loose upper sweeping arc */}
        <path d="M 50 220 C 90 110, 210 60, 340 85" stroke="currentColor" strokeWidth="0.75" opacity="0.32" strokeDasharray="5 5" />
        <path d="M 80 240 C 115 140, 215 95, 310 115" stroke="currentColor" strokeWidth="0.5" opacity="0.22" />
        {/* Asymmetrical loose lower counter arc - shorter and offset */}
        <path d="M 230 435 C 335 425, 420 360, 435 240" stroke="currentColor" strokeWidth="0.75" opacity="0.3" strokeDasharray="10 5" />
        <path d="M 270 410 C 350 400, 405 345, 415 260" stroke="currentColor" strokeWidth="0.5" opacity="0.2" />
        {/* Subtle Line Art Sunflower motif at upper arc tip */}
        <g transform="translate(340, 85) scale(0.6)" strokeLinecap="round">
          <circle cx="0" cy="0" r="7" fill="var(--color-paper)" stroke="currentColor" strokeWidth="0.85" />
          <circle cx="0" cy="0" r="3.5" stroke="var(--color-accent-subtle)" strokeWidth="0.6" fill="none" strokeDasharray="1.5 1.5" />
          {Array.from({ length: 12 }, (_, i) => {
            const angle = (i * 360) / 12;
            return (
              <g key={i} transform={`rotate(${angle})`}>
                <path
                  d="M 0 -7 C -3 -12, -1 -19, 0 -20 C 1 -19, 3 -12, 0 -7 Z"
                  stroke="var(--color-accent-subtle)"
                  strokeWidth="0.7"
                  fill="none"
                />
              </g>
            );
          })}
        </g>
        {/* Fine organic connecting line accents */}
        <path d="M 40 210 Q 75 190, 100 215" stroke="currentColor" strokeWidth="0.6" opacity="0.35" fill="none" />
        <path d="M 445 250 Q 420 280, 395 260" stroke="currentColor" strokeWidth="0.6" opacity="0.35" fill="none" />
      </svg>
    );
  }

  if (decoration === 'sunflower-flourish') {
    return (
      <svg className="sunflower-flourish-svg" viewBox="0 0 220 340" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        {/* Organic Stem Spline */}
        <path d="M 110 340 C 95 240, 155 150, 120 28" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
        <path d="M 120 28 C 115 12, 95 8, 85 22" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" opacity="0.7" />
        {/* Organic Leaves with Central Veins */}
        <g stroke="currentColor">
          <path d="M 102 265 C 55 255, 25 218, 42 196 C 70 208, 94 240, 102 265 Z" fill="var(--color-paper)" strokeWidth="0.85" />
          <path d="M 102 265 C 72 245, 52 225, 42 196" strokeWidth="0.5" opacity="0.65" />

          <path d="M 118 190 C 162 175, 192 140, 172 118 C 145 134, 122 168, 118 190 Z" fill="var(--color-paper)" strokeWidth="0.85" />
          <path d="M 118 190 C 148 168, 165 146, 172 118" strokeWidth="0.5" opacity="0.65" />

          <path d="M 112 115 C 72 98, 55 72, 72 56 C 92 72, 105 98, 112 115 Z" fill="var(--color-paper)" strokeWidth="0.75" />
        </g>
        {/* Line Art Sunflower Blossom */}
        <g transform="translate(120, 28) rotate(-12)" strokeLinecap="round">
          <circle cx="0" cy="0" r="13" fill="var(--color-paper)" stroke="currentColor" strokeWidth="1" />
          <circle cx="0" cy="0" r="8" stroke="var(--color-accent-subtle)" strokeWidth="0.75" fill="none" strokeDasharray="2 2" />
          <circle cx="0" cy="0" r="3" stroke="var(--color-accent-subtle)" strokeWidth="0.6" fill="var(--color-accent-subtle)" opacity="0.5" />
          {Array.from({ length: 18 }, (_, i) => {
            const angle = (i * 360) / 18;
            return (
              <g key={i} transform={`rotate(${angle})`}>
                <path
                  d="M 0 -13 C -4.5 -24, -1 -37, 0 -38 C 1 -37, 4.5 -24, 0 -13 Z"
                  stroke="var(--color-accent-subtle)"
                  strokeWidth="0.9"
                  fill="none"
                />
                <path
                  d="M 0 -13 L 0 -30"
                  stroke="var(--color-accent-subtle)"
                  strokeWidth="0.45"
                  opacity="0.55"
                />
              </g>
            );
          })}
        </g>
      </svg>
    );
  }

  if (decoration === 'sunflower-divider') {
    return (
      <svg className="sunflower-divider-svg" viewBox="0 0 260 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <line x1="0" y1="14" x2="105" y2="14" stroke="currentColor" strokeWidth="0.7" opacity="0.8" />
        <line x1="155" y1="14" x2="260" y2="14" stroke="currentColor" strokeWidth="0.7" opacity="0.8" />
        <g transform="translate(130, 14)" strokeLinecap="round">
          <circle cx="0" cy="0" r="5" fill="var(--color-paper)" stroke="currentColor" strokeWidth="0.85" />
          <circle cx="0" cy="0" r="2.5" stroke="var(--color-accent-subtle)" strokeWidth="0.6" fill="none" />
          {Array.from({ length: 12 }, (_, i) => {
            const angle = (i * 360) / 12;
            return (
              <path
                key={i}
                d="M 0 -5 C -2 -8, 0 -12, 0 -12 C 0 -12, 2 -8, 0 -5 Z"
                transform={`rotate(${angle})`}
                stroke="var(--color-accent-subtle)"
                strokeWidth="0.75"
                fill="none"
              />
            );
          })}
          <path d="M -12 0 C -18 -5, -24 -1, -26 0 C -24 1, -18 5, -12 0 Z" fill="none" stroke="currentColor" strokeWidth="0.7" />
          <path d="M 12 0 C 18 -5, 24 -1, 26 0 C 24 1, 18 5, 12 0 Z" fill="none" stroke="currentColor" strokeWidth="0.7" />
        </g>
      </svg>
    );
  }

  if (decoration === 'sunflower-footer') {
    return (
      <svg className="sunflower-footer-svg" viewBox="0 0 180 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M 10 22 Q 55 38 78 22" stroke="currentColor" strokeWidth="0.75" opacity="0.8" />
        <path d="M 170 22 Q 125 38 102 22" stroke="currentColor" strokeWidth="0.75" opacity="0.8" />
        <g transform="translate(90, 22)" strokeLinecap="round">
          <circle cx="0" cy="0" r="6" fill="none" stroke="var(--color-accent-subtle)" strokeWidth="0.9" />
          <circle cx="0" cy="0" r="2.5" stroke="var(--color-accent-subtle)" strokeWidth="0.6" fill="none" />
          {Array.from({ length: 12 }, (_, i) => {
            const angle = (i * 360) / 12;
            return (
              <path
                key={i}
                d="M 0 -6 C -2.5 -10, 0 -14, 0 -14 C 0 -14, 2.5 -10, 0 -6 Z"
                transform={`rotate(${angle})`}
                stroke="var(--color-accent-subtle)"
                strokeWidth="0.75"
                fill="none"
              />
            );
          })}
        </g>
      </svg>
    );
  }

  if (decoration === 'summer-botanical') {
    return (
      <>
        <span className="botanical-stem" />
        <span className="botanical-leaf botanical-leaf--one" />
        <span className="botanical-leaf botanical-leaf--two" />
        <span className="botanical-bud" />
        <span className="botanical-flower">
          {Array.from({ length: 10 }, (_, index) => <i key={index} />)}
          <b />
        </span>
      </>
    );
  }
  if (decoration === 'botanical-divider') {
    return <><i /><span><b /><b /><b /><b /><b /><b /></span><i /></>;
  }
  if (decoration === 'botanical-footer') {
    return <span><i /><i /><i /></span>;
  }
  return null;
}

export function ThemeDecoration({ theme, slot }: ThemeDecorationProps) {
  const decoration = theme.decorations[slot];
  if (!decoration) return null;

  return (
    <div
      className={`theme-decoration theme-decoration--${decoration} theme-decoration--${slot}`}
      aria-hidden="true"
    >
      {decorationContent(decoration)}
    </div>
  );
}

