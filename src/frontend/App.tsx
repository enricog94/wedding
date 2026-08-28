import { useEffect, useMemo, useState } from 'react';
import { Countdown } from '../components/Countdown';
import { EditorialPhotoSection } from '../components/EditorialPhotoSection';
import { LocationCard } from '../components/LocationCard';
import { Navigation } from '../components/Navigation';
import { Section } from '../components/Section';
import { SectionTitle } from '../components/SectionTitle';
import { TimelineItem } from '../components/TimelineItem';
import { ThemeDecoration } from '../components/ThemeDecoration';
import { DEFAULT_WEDDING_CONTENT, getWeddingContent } from '../lib/config';
import { applyWeddingTheme, getWeddingTheme } from '../lib/themes';
import { AdminPage } from './AdminPage';
import { GalleryPage } from './GalleryPage';
import { PhotoPage } from './PhotoPage';

const italianMonths = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];

function weddingDateParts(date: string) {
  const [year, month, day] = date.split('-');
  return { year, month, day };
}

function weddingDateLong(date: string) {
  const { year, month, day } = weddingDateParts(date);
  const monthName = italianMonths[Number(month) - 1];
  return `${Number(day)} ${monthName} ${year}`;
}

export function App() {
  const [content, setContent] = useState(DEFAULT_WEDDING_CONTENT);
  const isPhotoPage = window.location.pathname === '/foto' || window.location.pathname === '/foto/';
  const isGalleryPage = window.location.pathname === '/gallery' || window.location.pathname === '/gallery/';
  const isAdminPage = window.location.pathname === '/admin' || window.location.pathname === '/admin/';

  useEffect(() => {
    const controller = new AbortController();
    getWeddingContent(controller.signal).then(setContent).catch(() => {
      // Minimal identity defaults prevent a broken page during temporary API failures.
    });
    return () => controller.abort();
  }, []);

  const { wedding, schedule, locations, info } = content;
  const showSchedule = wedding.sections.scheduleEnabled && schedule.length > 0;
  const showLocations = wedding.sections.locationsEnabled && locations.length > 0;
  const showInfo = wedding.sections.infoEnabled && info.length > 0;

  useEffect(() => {
    document.title = `${wedding.brideName} & ${wedding.groomName}`;
  }, [wedding.brideName, wedding.groomName]);

  const target = useMemo(
    () => new Date(`${wedding.weddingDate}T00:00:00+02:00`),
    [wedding.weddingDate],
  );
  const theme = useMemo(() => getWeddingTheme(wedding.slug), [wedding.slug]);
  const date = weddingDateParts(wedding.weddingDate);
  const firstPublicSection = showSchedule
    ? '#programma'
    : showLocations
      ? '#location'
      : showInfo
        ? '#info'
        : null;

  useEffect(() => applyWeddingTheme(theme), [theme]);

  return (
    <>
      <Navigation
        brideName={wedding.brideName}
        groomName={wedding.groomName}
        sections={{ schedule: showSchedule, locations: showLocations, info: showInfo }}
      />
      {isPhotoPage ? <PhotoPage theme={theme} /> : isGalleryPage ? <GalleryPage /> : isAdminPage ? <AdminPage /> : <main>
        <div className="hero-viewport">
          <section id="home" className="hero" aria-labelledby="wedding-title">
            <ThemeDecoration theme={theme} slot="hero" />
            <ThemeDecoration theme={theme} slot="cornerBottom" />
            <ThemeDecoration theme={theme} slot="cornerTop" />
            <div className="hero__content">
              {wedding.heroEyebrow && <p className="script-detail">{wedding.heroEyebrow}</p>}
              {wedding.heroTitle ? (
                <h1 id="wedding-title">{wedding.heroTitle}</h1>
              ) : (
                <h1 id="wedding-title">{wedding.brideName} <span>&amp;</span> {wedding.groomName}</h1>
              )}
              {wedding.heroSubtitle && <p className="hero__subtitle">{wedding.heroSubtitle}</p>}
              <p className="hero__date">{date.day} <span>·</span> {date.month} <span>·</span> {date.year}</p>
            </div>
            {firstPublicSection && (
              <a className="scroll-cue" href={firstPublicSection}>
                Scopri <span aria-hidden="true">↓</span>
              </a>
            )}
          </section>

          <section className="countdown-strip" aria-label="Conto alla rovescia al matrimonio">
            <div className="countdown-strip__container">
              <Countdown key={wedding.weddingDate} target={target} />
            </div>
          </section>
        </div>

        <EditorialPhotoSection />

        {showSchedule && (
          <Section id="programma" tone="paper" className="program-section">
            <div className="section-layout">
              <SectionTitle eyebrow="La giornata" title="Programma" />
              <ol className="timeline" aria-label="Programma del matrimonio">
                {schedule.map((item) => (
                  <TimelineItem key={item.id} time={item.timeLabel} title={item.title} place={item.subtitle} description={item.description} />
                ))}
              </ol>
            </div>
          </Section>
        )}

        {showLocations && (
          <Section id="location" tone="ivory" className="location-section">
            <SectionTitle eyebrow="I luoghi" title="Location" align="center" />
            <div className="location-grid">
              {locations.map((location, index) => (
                <LocationCard
                  key={location.id}
                  number={String(index + 1).padStart(2, '0')}
                  kind={location.type}
                  name={location.name}
                  address={location.address}
                  mapsUrl={location.mapsUrl}
                  description={location.description}
                />
              ))}
            </div>
          </Section>
        )}

        {showInfo && (
          <Section id="info" tone="sage" className="info-section">
            <div className="section-layout section-layout--info">
              <SectionTitle eyebrow="Da sapere" title="Info utili" />
              <div className="info-list">
                {info.map((item) => (
                  <article className="info-item" key={item.id}>
                    <h3>{item.title}</h3>
                    {item.content && <p>{item.content}</p>}
                  </article>
                ))}
              </div>
            </div>
          </Section>
        )}
      </main>}
      <footer className="site-footer">
        <ThemeDecoration theme={theme} slot="footer" />
        <p className="site-footer__names">{wedding.brideName} &amp; {wedding.groomName}</p>
        <p>{weddingDateLong(wedding.weddingDate)}</p>
        <a href={isPhotoPage || isGalleryPage || isAdminPage ? '/#home' : '#home'}>{isPhotoPage || isGalleryPage || isAdminPage ? 'Torna alla Home' : 'Torna su'} <span aria-hidden="true">↑</span></a>
      </footer>
    </>
  );
}
