import type { ReactNode } from 'react';

type SectionProps = {
  id: string;
  children: ReactNode;
  tone?: 'ivory' | 'paper' | 'sage';
  className?: string;
};

export function Section({ id, children, tone = 'ivory', className = '' }: SectionProps) {
  return (
    <section id={id} className={`section section--${tone} ${className}`.trim()}>
      <div className="section__inner">{children}</div>
    </section>
  );
}
