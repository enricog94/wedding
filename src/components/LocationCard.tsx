type LocationCardProps = {
  number: string;
  name: string;
  kind?: string | null;
  address?: string | null;
  mapsUrl?: string | null;
  description?: string | null;
};

export function LocationCard({ number, name, kind, address, mapsUrl, description }: LocationCardProps) {
  return (
    <article className="location-card">
      <span className="location-card__number" aria-hidden="true">{number}</span>
      {kind && <p className="location-card__kind">{kind}</p>}
      <h3>{name}</h3>
      {(address || description) && (
        <p className="location-card__note">{[address, description].filter(Boolean).join(' · ')}</p>
      )}
      {mapsUrl && (
        <a className="button button--outline" href={mapsUrl} target="_blank" rel="noreferrer">
          Indicazioni
        </a>
      )}
    </article>
  );
}
