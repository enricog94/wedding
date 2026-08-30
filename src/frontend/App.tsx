import { useEffect, useMemo, useState, useRef, ReactNode } from 'react';
import { Countdown } from '../components/Countdown';
import { GalleryPreview } from '../components/GalleryPreview';
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

function FadeIn({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setIsVisible(true);
    }, { threshold: 0.15 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={`fade-in-wrap ${isVisible ? 'is-visible' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

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

  const { wedding, home, schedule, locations, info } = content;
  const showStory = home.storyEnabled;
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
  const firstPublicSection = showStory
    ? '#storia'
    : showSchedule
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
        sections={{
          story: showStory,
          schedule: showSchedule,
          locations: showLocations,
          info: showInfo,
        }}
        overHero={!isPhotoPage && !isGalleryPage && !isAdminPage}
      />
      {isPhotoPage ? <PhotoPage theme={theme} /> : isGalleryPage ? <GalleryPage /> : isAdminPage ? <AdminPage /> : <main>
        <div className="hero-viewport">
          <section id="home" className="hero hero--photo" aria-labelledby="wedding-title">
            <img
              className="hero-photo__image"
              src={wedding.heroPhoto?.previewUrl ?? '/images/serena-enrico-editorial.jpg'}
              alt={`${wedding.brideName} ed ${wedding.groomName} sorridono con i volti vicini tra gli alberi`}
              width="2993"
              height="1995"
              decoding="async"
              fetchPriority="high"
            />
            <div className="hero-photo__overlay" aria-hidden="true" />
            <div className="hero__content hero-photo__content">
              <p className="script-detail">{wedding.heroEyebrow || 'Ci sposiamo'}</p>
              {wedding.heroTitle ? (
                <h1 id="wedding-title" className="hero-photo__title hero-photo__title--custom">{wedding.heroTitle}</h1>
              ) : (
                <h1 id="wedding-title" className="hero-photo__title">
                  <span className="hero-photo__name">{wedding.brideName}</span>
                  <span className="hero-photo__ampersand">&amp;</span>
                  <span className="hero-photo__name">{wedding.groomName}</span>
                </h1>
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

        {showStory && (
          <Section id="storia" tone="paper" className="story-section">
            <SectionTitle eyebrow={home.storyEyebrow ?? ''} title={home.storyTitle ?? ''} align="center" />
            {home.storyIntro && <p className="story-intro">{home.storyIntro}</p>}
            {home.storyQuote && (
              <blockquote className="story-quote">
                <p>{home.storyQuote}</p>
                {home.storyQuoteAuthor && <cite>{home.storyQuoteAuthor}</cite>}
              </blockquote>
            )}
            <div className="story-timeline">
              <svg
                className="story-timeline__path"
                viewBox="0 0 1200 1000"
                preserveAspectRatio="none"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M620 0 C700 110 510 185 590 290 S705 450 610 555 S520 720 635 805 S700 930 600 1000" />
              </svg>
              {home.storyItems.map((item, index) => (
                <FadeIn key={item.id} delay={Math.min(index * 100, 400)} className={`story-moment${index % 2 === 1 ? ' story-moment--reverse' : ''}${item.photo ? '' : ' story-moment--without-photo'}`}>
                  {item.photo && (
                    <figure className="story-moment__media">
                      <img src={item.photo.previewUrl} alt={item.title} loading="lazy" decoding="async" />
                      {item.yearLabel && <figcaption>{item.yearLabel}</figcaption>}
                    </figure>
                  )}
                  <div className="story-moment__text">
                    {!item.photo && item.yearLabel && <p className="story-moment__year">{item.yearLabel}</p>}
                    <h3>{item.title}</h3>
                    {item.body && <p>{item.body}</p>}
                  </div>
                </FadeIn>
              ))}
            </div>
          </Section>
        )}

        {showSchedule && (
          <Section id="programma" tone="paper" className="program-section">
            <div className="section-layout">
              <SectionTitle eyebrow="La giornata" title="Programma" />
              <ol className="timeline" aria-label="Programma del matrimonio">
                {schedule.map((item, i) => (
                  <FadeIn key={item.id} delay={i * 150}>
                    <TimelineItem time={item.timeLabel} title={item.title} place={item.subtitle} description={item.description} />
                  </FadeIn>
                ))}
              </ol>
            </div>
          </Section>
        )}

        {showLocations && (
          <Section id="location" tone="ivory" className="location-section">
            <SectionTitle eyebrow="I luoghi" title="Location" align="center" />
            <div className="location-grid location-grid--editorial">
              {locations.map((location, index) => (
                <FadeIn key={location.id} delay={index * 150} className={`location-editorial${location.photo ? '' : ' location-editorial--without-image'}`}>
                  {location.photo && (
                    <img
                      className="location-editorial__image"
                      src={location.photo.previewUrl}
                      alt={location.name}
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                  <div className="location-editorial__content">
                    <LocationCard
                      number={String(index + 1).padStart(2, '0')}
                      kind={location.type}
                      name={location.name}
                      address={location.address}
                      mapsUrl={location.mapsUrl}
                      description={location.description}
                    />
                  </div>
                </FadeIn>
              ))}
            </div>
          </Section>
        )}

        {showInfo && (
          <Section id="info" tone="sage" className="info-section">
            <div className="section-layout section-layout--info">
              <SectionTitle eyebrow="Da sapere" title="Info utili" />
              <div className="info-list">
                {info.map((item, i) => (
                  <FadeIn key={item.id} delay={i * 100}>
                    <article className="info-item">
                      <h3>{item.title}</h3>
                      {item.content && <p>{item.content}</p>}
                    </article>
                  </FadeIn>
                ))}
              </div>
            </div>
          </Section>
        )}

        {/* M5.7: FOTO INVITATI */}
        <Section id="contributi" tone="paper" className="guest-photos-section">
          <FadeIn className="guest-photos-content">
            <SectionTitle eyebrow="Il vostro sguardo" title="Il matrimonio visto da voi" align="center" />
            <p className="guest-photos__desc">Aiutateci a raccogliere i momenti più belli della giornata attraverso i vostri occhi.</p>
            <a href="/foto" className="button button--solid">Condividi le tue foto</a>
          </FadeIn>
        </Section>

        <GalleryPreview />
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
