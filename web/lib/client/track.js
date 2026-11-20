// Funnel events go to the page's own dataLayer, so GTM on the website can forward them to GA4.
// Never put the visitor's email, name or phone in these events.
export function track(event, params = {}) {
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event, tool: 'gtg_checker', ...params });
  } catch {}
}

export function readUtm() {
  const out = {};
  try {
    const q = new URLSearchParams(window.location.search);
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) if (q.get(k)) out[k] = q.get(k);
  } catch {}
  return out;
}
