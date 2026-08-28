import { useEffect, useState } from 'react';
import { Section } from './Section';
import { SectionTitle } from './SectionTitle';

type PreviewMedia = {
  id: number;
  mimeType: string;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  previewStatus: string;
};

type GalleryResponse = {
  galleryEnabled: boolean;
  galleryPreviewEnabled: boolean;
  media: PreviewMedia[];
};

const ROTATION_INTERVAL_MS = 15_000;
const MAX_PREVIEW_MEDIA = 4;

function randomSubset<T>(items: T[], count: number): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled.slice(0, count);
}

export function GalleryPreview() {
  const [availableMedia, setAvailableMedia] = useState<PreviewMedia[]>([]);
  const [visibleMedia, setVisibleMedia] = useState<PreviewMedia[]>([]);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/gallery', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('gallery');
        return response.json() as Promise<GalleryResponse>;
      })
      .then((result) => {
        const candidates = Array.isArray(result.media)
          ? result.media.filter((item) => (
            item.mimeType.startsWith('image/')
            && item.previewStatus === 'ready'
            && Boolean(item.thumbnailUrl || item.previewUrl)
          ))
          : [];
        const previewEnabled = result.galleryEnabled === true && result.galleryPreviewEnabled === true;
        setEnabled(previewEnabled);
        setAvailableMedia(previewEnabled ? candidates : []);
        setVisibleMedia(previewEnabled
          ? randomSubset(candidates, Math.min(MAX_PREVIEW_MEDIA, candidates.length))
          : []);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setEnabled(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (availableMedia.length <= MAX_PREVIEW_MEDIA) return undefined;

    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timerId: number | null = null;

    const rotateOne = () => {
      setVisibleMedia((current) => {
        const visibleIds = new Set(current.map((item) => item.id));
        const replacements = availableMedia.filter((item) => !visibleIds.has(item.id));
        if (current.length === 0 || replacements.length === 0) return current;

        const slot = Math.floor(Math.random() * current.length);
        const replacement = replacements[Math.floor(Math.random() * replacements.length)];
        return current.map((item, index) => (index === slot ? replacement : item));
      });
    };

    const stopTimer = () => {
      if (timerId !== null) window.clearInterval(timerId);
      timerId = null;
    };

    const startTimer = () => {
      if (timerId === null && document.visibilityState === 'visible' && !motionPreference.matches) {
        timerId = window.setInterval(rotateOne, ROTATION_INTERVAL_MS);
      }
    };

    const updateTimer = () => {
      stopTimer();
      startTimer();
    };

    startTimer();
    document.addEventListener('visibilitychange', updateTimer);
    motionPreference.addEventListener('change', updateTimer);
    return () => {
      stopTimer();
      document.removeEventListener('visibilitychange', updateTimer);
      motionPreference.removeEventListener('change', updateTimer);
    };
  }, [availableMedia]);

  if (!enabled || visibleMedia.length === 0) return null;

  return (
    <Section id="gallery-preview" tone="ivory" className="gallery-preview-section">
      <SectionTitle eyebrow="Ricordi" title="Gallery" align="center" />
      <div className="gallery-preview-grid" data-count={visibleMedia.length}>
        {visibleMedia.map((item, index) => (
          <a
            className={`gp-img gp-img--${index + 1}`}
            href="/gallery"
            key={index}
            aria-label={`Apri la gallery dal ricordo ${index + 1}`}
          >
            <img
              src={item.thumbnailUrl || item.previewUrl || undefined}
              alt="Ricordo condiviso nella gallery del matrimonio"
              loading="lazy"
              decoding="async"
              key={item.id}
            />
          </a>
        ))}
      </div>
      <div className="gallery-preview__action">
        <a href="/gallery" className="button">Scopri tutti i ricordi</a>
      </div>
    </Section>
  );
}
