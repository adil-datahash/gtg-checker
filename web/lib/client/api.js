// Calls the scanner API (the Cloudflare Worker). Its address is set at build time.
const BASE = (process.env.NEXT_PUBLIC_API_BASE || '').replace(/\/$/, '');
export const API_CONFIGURED = Boolean(BASE);

async function post(path, body) {
  if (!BASE) throw { code: 'not_configured', message: 'The checker is not connected to its scanner yet. Set NEXT_PUBLIC_API_BASE and rebuild.' };
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw { code: 'network', message: 'We could not reach the checker. Check your connection and try again.' };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { code: data.error || 'error', message: data.message || 'Something went wrong. Try again in a minute.' };
  return data;
}

export const scanSite = (url, turnstileToken) => post('/api/scan', { url, turnstileToken });
export const submitLead = ({ url, lead, utm }) => post('/api/lead', { url, ...lead, utm, page: window.location.href });
