import type { ThemeDecoration as Decoration, WeddingTheme } from '../lib/themes';

type DecorationSlot = keyof WeddingTheme['decorations'];

type ThemeDecorationProps = {
  theme: WeddingTheme;
  slot: DecorationSlot;
};

function decorationContent(decoration: Decoration) {
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
