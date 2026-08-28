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
    { href: '/gallery', label: 'Gallery', visible: true },
  ].filter((link) => link.visible);

  const toggleMenu = () => {
    setIsOpen((open) => {
      const next = !open;
      document.body.dataset.navOpen = String(next);
      return next;
    });
  };

  const closeMenu = () => {
    setIsOpen(false);
    document.body.dataset.navOpen = 'false';
  };

  return (
    <header className="site-header">
      <a className="site-mark" href="/#home" onClick={closeMenu} aria-label={`${brideName} e ${groomName}, torna alla Home`}>
        {brideInitial} <span>&amp;</span> {groomInitial}
      </a>
      <button
        className="menu-toggle"
        type="button"
        aria-expanded={isOpen}
        aria-controls="site-navigation"
        onClick={toggleMenu}
      >
        <span className="menu-toggle__label">{isOpen ? 'Chiudi' : 'Menu'}</span>
        <span className="menu-toggle__icon" aria-hidden="true"><i /><i /></span>
      </button>
      <nav id="site-navigation" className="site-nav" data-open={isOpen} aria-label="Navigazione principale">
        <div className="site-nav__links">
          {links.map((link) => (
            <a key={link.href} href={link.href} onClick={closeMenu}>
              {link.label}
            </a>
          ))}
        </div>
        <div className="site-nav__footer">
          <p className="site-nav__names">{brideName} &amp; {groomName}</p>
          <p className="site-nav__date">24 · 07 · 2027</p>
        </div>
      </nav>
    </header>
  );
}
