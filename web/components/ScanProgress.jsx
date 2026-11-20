'use client';

import { useEffect, useState } from 'react';

const STEPS = [
  'Loading your page',
  'Finding Google tags',
  'Looking for a gateway path on your domain',
  'Identifying your CDN and servers'
];

export default function ScanProgress({ host }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setActive((a) => Math.min(a + 1, STEPS.length - 1)), 700);
    return () => clearInterval(t);
  }, []);
  return (
    <section className="scan-progress" aria-live="polite">
      <p className="sp-host">Checking <span className="mono">{host}</span></p>
      <ol className="sp-steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i < active ? 'done' : i === active ? 'active' : ''}>
            <span className="sp-dot" aria-hidden="true" />
            {s}
          </li>
        ))}
      </ol>
    </section>
  );
}
