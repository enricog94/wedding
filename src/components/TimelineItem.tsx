type TimelineItemProps = {
  time: string;
  title: string;
  place?: string | null;
  description?: string | null;
};

export function TimelineItem({ time, title, place, description }: TimelineItemProps) {
  return (
    <li className="timeline-item">
      <div className="timeline-item__marker" aria-hidden="true" />
      <time>{time}</time>
      <div className="timeline-item__content">
        <h3>{title}</h3>
        {place && <p>{place}</p>}
        {description && <p>{description}</p>}
      </div>
    </li>
  );
}
