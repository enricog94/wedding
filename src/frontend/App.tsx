import { useEffect, useMemo, useState } from 'react';
import { Countdown } from '../components/Countdown';
import { DEFAULT_WEDDING_DATE, getWeddingConfig } from '../lib/config';

export function App() {
  const [weddingDate, setWeddingDate] = useState(DEFAULT_WEDDING_DATE);

  useEffect(() => {
    const controller = new AbortController();

    getWeddingConfig(controller.signal)
      .then((config) => setWeddingDate(config.weddingDate))
      .catch(() => {
        // The bundled date keeps the home usable before local D1 is migrated.
      });

    return () => controller.abort();
  }, []);

  const target = useMemo(
    () => new Date(`${weddingDate}T00:00:00+02:00`),
    [weddingDate],
  );

  return (
    <main className="home">
      <div className="home__glow" aria-hidden="true" />
      <section className="hero" aria-labelledby="wedding-title">
        <p className="eyebrow">Il nostro matrimonio</p>
        <h1 id="wedding-title">
          Serena <span aria-hidden="true">&amp;</span> Enrico
        </h1>
        <div className="ornament" aria-hidden="true"><span /></div>
        <p className="date">24 <span>·</span> 07 <span>·</span> 2027</p>
        <Countdown key={weddingDate} target={target} />
      </section>
    </main>
  );
}
