import { useState } from 'react';

type NavigationProps = {
  brideName: string;
  groomName: string;
  sections?: {
    schedule: boolean;
    locations: boolean;
    info: boolean;
  };
};

export function Navigation({ brideName, groomName, sections }: NavigationProps) {
  const [isOpen, setIsOpen] = useState(false);
  const brideInitial = brideName.trim().charAt(0).toUpperCase();
  const groomInitial = groomName.trim().charAt(0).toUpperCase();
  const links = [
    { href: '/#home', label: 'Home', visible: true },
    { href: '/#programma', label: 'Programma', visible: sections?.schedule !== false },
    { href: '/#location', label: 'Location', visible: sections?.locations !== false },
    { href: '/#info', label: 'Info', visible: sections?.info !== false },
    { href: '/foto', label: 'Foto', visible: true },
    { href: '/gallery', label: 'Gallery', visible: true },
  ].filter((link) => link.visible);

  return (
    <header className="site-header">
      <a className="site-mark" href="/#home" aria-label={`${brideName} e ${groomName}, torna alla Home`}>
        {brideInitial} <span>&amp;</span> {groomInitial}
      </a>
      <button
        className="menu-toggle"
        type="button"
        aria-expanded={isOpen}
        aria-controls="site-navigation"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="menu-toggle__label">Menu</span>
        <span className="menu-toggle__icon" aria-hidden="true"><i /><i /></span>
      </button>
      <nav id="site-navigation" className="site-nav" data-open={isOpen} aria-label="Navigazione principale">
        {links.map((link) => (
          <a key={link.href} href={link.href} onClick={() => setIsOpen(false)}>
            {link.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
