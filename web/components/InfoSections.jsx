import platforms from '@/lib/client/platforms.json';
const CHECKS = [
  { t: 'Where your tags load from', d: 'We read your home page and find every Google Tag Manager, GA4 and Google Ads tag, and whether it loads from googletagmanager.com or from a path on your own domain.' },
  { t: 'Whether the gateway answers', d: 'If we find a path on your domain, we call its health check and confirm it returns Google tag code.' },
  { t: 'What sits in front of your site', d: 'We read public response headers and DNS records to identify your CDN, load balancer or web server, and whether it handles all traffic or only images and files.' },
  { t: 'How you would set it up', d: 'We match your infrastructure to the setup route that fits it, so your developers know where the change goes.' }
];

const FAQ = [
  { q: 'What is Google tag gateway?', a: 'It is a Google feature that serves your Google tags from your own domain instead of googletagmanager.com. Your CDN or server forwards a chosen path to Google. Because the requests are first-party, fewer of them are stopped by ad blockers and browser privacy rules.' },
  { q: 'Is it the same as server-side tagging?', a: 'No. Server-side tagging runs your own tagging server, usually on a subdomain. Google tag gateway is a lighter change on the CDN or server you already have. Many sites use both.' },
  { q: 'Is this check safe to run?', a: 'Yes. We only read what any browser can see: the public home page, its response headers and public DNS records. We never log in, change anything, or test for vulnerabilities.' },
  { q: 'Why might the result be incomplete?', a: 'Some tags load only after cookie consent, only on certain pages, or through scripts we cannot see in the page source. Some sites block automated checks. In those cases we can check by hand.' }
];

export default function InfoSections() {
  return (
    <>
      <section className="info" aria-labelledby="checks-title">
        <h2 id="checks-title">What the checker looks at</h2>
        <div className="checks">
          {CHECKS.map((c) => (
            <div key={c.t} className="check">
              <h3>{c.t}</h3>
              <p>{c.d}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="info" aria-labelledby="platforms-title">
        <h2 id="platforms-title">Platforms the checker recognises</h2>
        <p className="info-lede">{platforms.total} CDNs, firewalls, load balancers, hosts and web servers. Each one has its own setup route in the report.</p>
        <div className="platforms">
          {platforms.groups.map((g) => (
            <div key={g.kind} className="platform-group">
              <h3>{g.label}</h3>
              <ul>{g.names.map((n) => <li key={n}>{n}</li>)}</ul>
            </div>
          ))}
        </div>
      </section>
      <section className="info" aria-labelledby="faq-title">
        <h2 id="faq-title">Questions</h2>
        <div className="faq">
          {FAQ.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
