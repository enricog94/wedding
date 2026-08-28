import type { ThemeDecoration as Decoration, WeddingTheme } from '../lib/themes';

type DecorationSlot = keyof WeddingTheme['decorations'];

type ThemeDecorationProps = {
  theme: WeddingTheme;
  slot: DecorationSlot;
};

function decorationContent(decoration: Decoration) {
  if (decoration === 'sunflower-orbit') {
    return (
      <svg className="sunflower-orbit-svg" viewBox="0 0 500 500" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="250" cy="250" r="240" stroke="currentColor" strokeWidth="1" strokeDasharray="4 4" opacity="0.4" />
        <circle cx="250" cy="250" r="248" stroke="currentColor" strokeWidth="0.75" opacity="0.75" />
        {/* Accent Sunflower Line Art motif at orbit top */}
        <g transform="translate(250, 2) scale(0.7)" stroke="currentColor" strokeWidth="1" strokeLinecap="round">
          {/* Sunflower Head Center */}
          <circle cx="0" cy="0" r="7" fill="var(--color-paper)" stroke="currentColor" />
          <circle cx="0" cy="0" r="3" stroke="var(--color-accent-subtle)" strokeWidth="0.8" fill="none" />
          {/* Elongated Petals */}
          {Array.from({ length: 16 }, (_, i) => {
            const angle = (i * 360) / 16;
            return (
              <path
                key={i}
                d="M 0 -7 C -2.5 -14, 0 -22, 0 -22 C 0 -22, 2.5 -14, 0 -7"
                transform={`rotate(${angle})`}
                stroke="var(--color-accent-subtle)"
                strokeWidth="0.9"
                fill="none"
              />
            );
          })}
        </g>
        {/* Side leaves along orbit */}
        <path d="M 12 250 Q -15 220 8 190 Q 20 220 12 250 Z" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />
        <path d="M 488 250 Q 515 280 492 310 Q 480 280 488 250 Z" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />
      </svg>
    );
  }

  if (decoration === 'sunflower-flourish') {
    return (
      <svg className="sunflower-flourish-svg" viewBox="0 0 200 320" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        {/* Organic Stem */}
        <path d="M 100 320 C 90 220, 140 140, 110 20" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        <path d="M 110 20 C 105 5, 85 0, 75 15" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
        {/* Leaves */}
        <path d="M 98 250 C 60 240, 30 210, 45 190 C 70 200, 92 230, 98 250 Z" fill="var(--color-paper)" stroke="currentColor" strokeWidth="0.9" />
        <path d="M 112 180 C 150 165, 175 135, 160 115 C 135 130, 115 160, 112 180 Z" fill="var(--color-paper)" stroke="currentColor" strokeWidth="0.9" />
        <path d="M 106 110 C 70 95, 55 70, 70 55 C 88 70, 100 95, 106 110 Z" fill="var(--color-paper)" stroke="currentColor" strokeWidth="0.8" />
        {/* Reinterpreted Line Art Sunflower Blossom */}
        <g transform="translate(110, 20) rotate(-15)" strokeLinecap="round">
          <circle cx="0" cy="0" r="12" fill="var(--color-paper)" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="0" cy="0" r="7" stroke="var(--color-accent-subtle)" strokeWidth="0.9" fill="none" strokeDasharray="2 2" />
          {Array.from({ length: 18 }, (_, i) => {
            const angle = (i * 360) / 18;
            return (
              <path
                key={i}
                d="M 0 -12 C -4 -24, 0 -36, 0 -36 C 0 -36, 4 -24, 0 -12"
                transform={`rotate(${angle})`}
                stroke="var(--color-accent-subtle)"
                strokeWidth="1"
                fill="none"
              />
            );
          })}
        </g>
      </svg>
    );
  }

  if (decoration === 'sunflower-divider') {
    return (
      <svg className="sunflower-divider-svg" viewBox="0 0 240 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <line x1="0" y1="12" x2="95" y2="12" stroke="currentColor" strokeWidth="0.75" />
        <line x1="145" y1="12" x2="240" y2="12" stroke="currentColor" strokeWidth="0.75" />
        {/* Center Sunflower Line Art Motif */}
        <g transform="translate(120, 12)">
          <circle cx="0" cy="0" r="4" fill="var(--color-paper)" stroke="currentColor" strokeWidth="0.9" />
          <circle cx="0" cy="0" r="2" stroke="var(--color-accent-subtle)" strokeWidth="0.6" fill="none" />
          {Array.from({ length: 12 }, (_, i) => {
            const angle = (i * 360) / 12;
            return (
              <path
                key={i}
                d="M 0 -4 C -1.5 -7, 0 -10, 0 -10 C 0 -10, 1.5 -7, 0 -4"
                transform={`rotate(${angle})`}
                stroke="var(--color-accent-subtle)"
                strokeWidth="0.8"
                fill="none"
              />
            );
          })}
          {/* Leaves flanking */}
          <path d="M -10 0 C -15 -4, -20 -1, -22 0 C -20 1, -15 4, -10 0 Z" fill="none" stroke="currentColor" strokeWidth="0.75" />
          <path d="M 10 0 C 15 -4, 20 -1, 22 0 C 20 1, 15 4, 10 0 Z" fill="none" stroke="currentColor" strokeWidth="0.75" />
        </g>
      </svg>
    );
  }

  if (decoration === 'sunflower-footer') {
    return (
      <svg className="sunflower-footer-svg" viewBox="0 0 160 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M 10 20 Q 50 35 70 20" stroke="currentColor" strokeWidth="0.8" />
        <path d="M 150 20 Q 110 35 90 20" stroke="currentColor" strokeWidth="0.8" />
        <g transform="translate(80, 20)">
          <circle cx="0" cy="0" r="5" fill="none" stroke="var(--color-accent-subtle)" strokeWidth="1" />
          {Array.from({ length: 12 }, (_, i) => {
            const angle = (i * 360) / 12;
            return (
              <path
                key={i}
                d="M 0 -5 C -2 -9, 0 -13, 0 -13 C 0 -13, 2 -9, 0 -5"
                transform={`rotate(${angle})`}
                stroke="var(--color-accent-subtle)"
                strokeWidth="0.8"
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

