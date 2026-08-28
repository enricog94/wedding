export type ThemeDecoration =
  | 'botanical-orbit'
  | 'summer-botanical'
  | 'botanical-divider'
  | 'botanical-footer';

export type WeddingTheme = {
  id: string;
  colors: {
    background: string;
    backgroundDeep: string;
    paper: string;
    text: string;
    muted: string;
    primary: string;
    secondary: string;
    accent: string;
    border: string;
    tintedSurface: string;
    error: string;
  };
  fonts: {
    decorative: string;
    display: string;
    body: string;
    stylesheetUrl: string;
  };
  decorations: {
    hero?: ThemeDecoration;
    cornerTop?: ThemeDecoration;
    cornerBottom?: ThemeDecoration;
    divider?: ThemeDecoration;
    footer?: ThemeDecoration;
  };
};

export const botanicalSageTheme: WeddingTheme = {
  id: 'botanical-sage',
  colors: {
    background: '#f7f4ed',
    backgroundDeep: '#eeeadf',
    paper: '#fcfaf5',
    text: '#35352f',
    muted: '#67685f',
    primary: '#66705a',
    secondary: '#aab29c',
    accent: '#b7a58d',
    border: 'rgba(102, 112, 90, 0.24)',
    tintedSurface: '#e7eadf',
    error: '#854c40',
  },
  fonts: {
    decorative: "'Style Script', cursive",
    display: "'Cormorant Garamond', Georgia, serif",
    body: "'Inter', Arial, sans-serif",
    stylesheetUrl: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Inter:wght@400;500;600&family=Style+Script&display=swap',
  },
  decorations: {
    hero: 'botanical-orbit',
    cornerTop: 'summer-botanical',
    cornerBottom: 'summer-botanical',
    divider: 'botanical-divider',
    footer: 'botanical-footer',
  },
};

const themes: Record<string, WeddingTheme> = {
  [botanicalSageTheme.id]: botanicalSageTheme,
};

const weddingThemes: Record<string, string> = {
  'serena-enrico-2027': 'botanical-sage',
};

export function getWeddingTheme(weddingSlug: string): WeddingTheme {
  return themes[weddingThemes[weddingSlug]] ?? botanicalSageTheme;
}

export function applyWeddingTheme(theme: WeddingTheme): void {
  const root = document.documentElement;
  root.dataset.theme = theme.id;

  const variables = {
    '--color-background': theme.colors.background,
    '--color-background-deep': theme.colors.backgroundDeep,
    '--color-paper': theme.colors.paper,
    '--color-text': theme.colors.text,
    '--color-muted': theme.colors.muted,
    '--color-primary': theme.colors.primary,
    '--color-secondary': theme.colors.secondary,
    '--color-accent': theme.colors.accent,
    '--color-border': theme.colors.border,
    '--color-tinted-surface': theme.colors.tintedSurface,
    '--color-error': theme.colors.error,
    '--font-decorative': theme.fonts.decorative,
    '--font-display': theme.fonts.display,
    '--font-body': theme.fonts.body,
  };

  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
  }

  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', theme.colors.background);

  let fontStylesheet = document.querySelector<HTMLLinkElement>('#wedding-theme-fonts');
  if (!fontStylesheet) {
    fontStylesheet = document.createElement('link');
    fontStylesheet.id = 'wedding-theme-fonts';
    fontStylesheet.rel = 'stylesheet';
    document.querySelector('head')?.appendChild(fontStylesheet);
  }
  if (fontStylesheet.href !== theme.fonts.stylesheetUrl) {
    fontStylesheet.href = theme.fonts.stylesheetUrl;
  }
}
