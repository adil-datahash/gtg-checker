export const BOOKING_URL = process.env.NEXT_PUBLIC_BOOKING_URL || 'https://datahash.com/contact';
export const PRIVACY_URL = process.env.NEXT_PUBLIC_PRIVACY_URL || 'https://datahash.com/privacy-policy';

// Headline + explanation for each verdict. Keep in plain language: the reader is a marketer.
export function verdictCopy(s) {
  switch (s.status) {
    case 'implemented':
      return s.confidence === 'verified'
        ? { tone: 'good', title: 'Google tag gateway is set up', body: 'Your Google tags load through your own domain, and the gateway health check answered correctly.' }
        : { tone: 'warn', title: 'Google tag gateway looks set up', body: 'Your Google tags load through your own domain, but the gateway health check did not confirm it. It may be misconfigured.' };
    case 'partial':
      return { tone: 'warn', title: 'Google tag gateway is partly set up', body: 'Some of your Google tags load through your own domain. Others still load straight from Google, where ad blockers and privacy browsers can stop them.' };
    case 'not_implemented':
      if (s.servingMode === 'server_side_tagging') return { tone: 'bad', title: 'Google tag gateway is not set up', body: 'Your tags load through a server-side tagging domain. That helps, but it is a different setup from Google tag gateway.' };
      if (s.servingMode === 'not_in_static_html') return { tone: 'bad', title: 'Google tag gateway was not found', body: 'Your Google tags are added by a script after the page loads, so we could not see a gateway path. Most sites in this state load tags straight from Google.' };
      return { tone: 'bad', title: 'Google tag gateway is not set up', body: 'Your Google tags load straight from googletagmanager.com. Ad blockers and privacy browsers can stop those requests, so some conversions never reach Google Ads or GA4.' };
    case 'unconfirmed':
      return {
        tone: 'neutral',
        title: 'We could not confirm Google tag gateway',
        body: s.unconfirmedReason === 'not_seen_in_browser'
          ? 'A Google tag is on this page, but we could not see where it loads from, even after loading the page in a browser. Tags often wait for cookie consent or load only on some pages. We can check it by hand.'
          : 'A Google tag is on this page, but it is added by a script after the page loads, so this quick check cannot see where it loads from. We can check it by hand.'
      };
    case 'no_google_tags':
      return { tone: 'neutral', title: 'No Google tags found', body: 'We did not find Google Tag Manager, GA4 or Google Ads tags on this page. If you expected them, they may load only on other pages or after cookie consent.' };
    case 'blocked':
      return { tone: 'neutral', title: 'We could not scan this site automatically', body: `The site's security layer stopped our checker${s.blockedReason ? ` (${s.blockedReason})` : ''}. That is common on well-protected sites, and we can check it by hand.` };
    default:
      return { tone: 'neutral', title: 'Check complete', body: '' };
  }
}

export const ELIGIBILITY = {
  yes: { label: 'Ready for setup', text: 'Your setup supports Google tag gateway.' },
  conditional: { label: 'Possible, with checks', text: 'Possible, but depends on your plan or provider.' },
  limited: { label: 'Limited', text: 'Your platform controls the servers, which limits your options.' }
};

export const PROXY_TYPE = {
  full_reverse_proxy: 'All traffic to your domain passes through this layer, so the gateway can be configured there.',
  asset_only_cdn: 'Your CDN serves only images and files. Your main domain goes straight to the web server.',
  managed_platform: 'Your hosting platform runs the edge for you, so changes go through the platform.',
  origin_direct: 'No CDN in front of your domain. Visitors reach your web server directly.',
  unknown: 'We could not tell what sits in front of your domain.'
};

// The next step changes with the result. This is where the lead turns into a conversation.
export function nextStep(report) {
  const st = report.verdict.status;
  const route = report.route;
  if (st === 'unconfirmed') return { title: 'Get a manual check', body: 'Our team will open your site the way a visitor does, accept consent, and confirm where your Google tags load from. Usually within one working day.', cta: 'Request a manual check' };
  if (st === 'blocked') return { title: 'Get a manual check', body: 'Our team will review your site by hand and send you the result, usually within one working day.', cta: 'Request a manual check' };
  if (st === 'implemented' && report.verdict.confidence === 'verified') return { title: 'Make sure every conversion is counted', body: 'Your gateway is live. The next gaps are usually server-side conversions and match quality on Meta and Google. We can check both for free.', cta: 'Book a free tracking health check' };
  if (st === 'implemented' || st === 'partial') return { title: 'Finish the setup', body: 'Some tags still bypass your gateway, or the health check is failing. We can find the gap and fix it with your team.', cta: 'Book a call to fix it' };
  if (st === 'no_google_tags') return { title: 'Talk through your measurement setup', body: 'Without Google tags on this page, Google Ads and GA4 may be missing data. We can review what you track and where.', cta: 'Book a measurement review' };
  if (route.eligible === 'yes') return { title: `Set it up on ${route.label}`, body: `This is a setup we do regularly. Expected effort: ${route.effort.toLowerCase()}. Your team keeps full control of the change.`, cta: 'Book a setup call' };
  if (route.eligible === 'limited') return { title: 'See what is possible on your platform', body: 'Hosted platforms limit server changes. We can tell you what is possible and what it would gain you.', cta: 'Book a free consultation' };
  return { title: 'Check your options', body: 'Your setup needs a closer look before we can confirm the route. A short call is usually enough.', cta: 'Book a free consultation' };
}
