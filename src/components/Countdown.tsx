import { useEffect, useState } from 'react';

type TimeLeft = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function calculateTimeLeft(target: Date): TimeLeft {
  const difference = Math.max(0, target.getTime() - Date.now());

  return {
    days: Math.floor(difference / DAY),
    hours: Math.floor((difference % DAY) / HOUR),
    minutes: Math.floor((difference % HOUR) / MINUTE),
    seconds: Math.floor((difference % MINUTE) / SECOND),
  };
}

const units: Array<{ key: keyof TimeLeft; label: string }> = [
  { key: 'days', label: 'giorni' },
  { key: 'hours', label: 'ore' },
  { key: 'minutes', label: 'minuti' },
  { key: 'seconds', label: 'secondi' },
];

export function Countdown({ target }: { target: Date }) {
  const [timeLeft, setTimeLeft] = useState(() => calculateTimeLeft(target));

  useEffect(() => {
    const timer = window.setInterval(
      () => setTimeLeft(calculateTimeLeft(target)),
      SECOND,
    );

    return () => window.clearInterval(timer);
  }, [target]);

  return (
    <div className="countdown" aria-label="Conto alla rovescia al matrimonio">
      {units.map(({ key, label }) => (
        <div className="countdown__unit" key={key}>
          <strong>{String(timeLeft[key]).padStart(2, '0')}</strong>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
