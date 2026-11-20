'use client';

import { useEffect, useRef } from 'react';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';
export const TURNSTILE_ON = Boolean(SITE_KEY);

let loader;
function loadScript() {
  if (window.turnstile) return Promise.resolve();
  if (!loader) {
    loader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return loader;
}

export default function Turnstile({ onToken }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!SITE_KEY) return;
    let id;
    loadScript().then(() => {
      if (!ref.current) return;
      id = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY,
        size: 'flexible',
        callback: (t) => onToken(t),
        'expired-callback': () => onToken(''),
        'error-callback': () => onToken('')
      });
    }).catch(() => onToken(''));
    return () => { if (id !== undefined && window.turnstile) window.turnstile.remove(id); };
  }, [onToken]);
  if (!SITE_KEY) return null;
  return <div className="turnstile" ref={ref} />;
}
