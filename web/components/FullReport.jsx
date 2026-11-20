'use client';

import { BOOKING_URL, PROXY_TYPE, ELIGIBILITY, nextStep } from '@/lib/client/copy.js';
import { track } from '@/lib/client/track.js';

const SERVING = {
  google: 'Straight from googletagmanager.com',
  first_party_path: 'Through your domain (gateway path)',
  first_party_root: 'From your domain root',
  first_party_subdomain: 'From your subdomain (server-side tagging)',
  third_party_proxy: 'From another proxy domain'
};

function IdList({ label, ids }) {
  if (!ids?.length) return null;
  return (
    <div className="id-row">
      <span className="id-label">{label}</span>
      <span className="id-values">{ids.map((id) => <code key={id}>{id}</code>)}</span>
    </div>
  );
}

export default function FullReport({ report, dryRun }) {
  const step = nextStep(report);
  const probes = Object.values(report.probes || {});
  const hasGateway = ['implemented', 'partial'].includes(report.verdict.status);
  const elig = ELIGIBILITY[report.route.eligible];
  const bookUrl = `${BOOKING_URL}${BOOKING_URL.includes('?') ? '&' : '?'}source=gtg-checker&site=${encodeURIComponent(report.host)}`;

  return (
    <section className="report" aria-labelledby="report-title">
      <h2 id="report-title">Full report for <span className="mono">{report.host}</span></h2>
      {dryRun ? <p className="dry-run-note">Test mode: this report was not emailed and no lead was saved.</p> : <p className="sent-note">We have also emailed you a copy.</p>}

      {hasGateway ? (
        <div className="report-block">
          <h3>How your gateway is deployed</h3>
          {report.gtg ? (
            <>
              <p className="gtg-summary">{report.gtg.summary}</p>
              <dl className="kv">
                <div><dt>Gateway runs on</dt><dd>{report.gtg.servedBy || 'Not identified'}</dd></div>
                {report.gtg.layers?.length > 1 ? <div><dt>Layers on the gateway path</dt><dd>{report.gtg.layers.join(', then ')}</dd></div> : null}
                <div><dt>Gateway path</dt><dd><code>{report.host}{report.gtg.path}</code></dd></div>
                <div><dt>How we know</dt><dd>{report.gtg.basis === 'gateway_response' ? 'From the headers on the gateway response itself' : report.gtg.basis === 'site_infrastructure' ? 'From the rest of your site (the gateway response did not identify its CDN)' : 'Not identified'}</dd></div>
                {report.gtg.cacheStatus ? <div><dt>Edge cache</dt><dd><code>{report.gtg.cacheStatus}</code></dd></div> : null}
                {report.gtg.differsFromSite ? <div><dt>Rest of your site</dt><dd>{report.gtg.sitePrimary}</dd></div> : null}
              </dl>
              {report.gtg.signals?.length ? (
                <details className="evidence">
                  <summary>Show the gateway evidence</summary>
                  <ul>{report.gtg.signals.map((s, i) => <li key={i}>{s.check}: <code>{s.value}</code> points to {s.points_to}</li>)}</ul>
                </details>
              ) : null}
              <h4 className="subhead">Health checks</h4>
            </>
          ) : null}
          {probes.map((p) => (
            <div key={p.path} className="probe">
              <code>{report.host}{p.path}</code>
              <span className={p.healthy ? 'ok' : 'fail'}>{p.healthy ? 'Health check answered ok' : 'Health check did not answer ok'}</span>
              {p.servesGoogleJs !== null && p.servesGoogleJs !== undefined ? (
                <span className={p.servesGoogleJs ? 'ok' : 'fail'}>{p.servesGoogleJs ? 'Serves Google tag code' : 'Did not return Google tag code'}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {report.verdict.status !== 'blocked' ? (
        <div className="report-block">
          <h3>Google tags on the page</h3>
          {report.tags.gtm.length + report.tags.ga4.length + report.tags.ads.length === 0 ? <p>None found in the page source.</p> : null}
          <IdList label="Tag Manager" ids={report.tags.gtm} />
          <IdList label="GA4" ids={report.tags.ga4} />
          <IdList label="Google Ads" ids={report.tags.ads} />
          <IdList label="Floodlight" ids={report.tags.floodlight} />
          {report.tags.loaders.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">Tag</th><th scope="col">Loads</th></tr></thead>
                <tbody>
                  {report.tags.loaders.map((l) => (
                    <tr key={`${l.id}-${l.serving}-${l.path}`}>
                      <td><code>{l.id}</code></td>
                      <td>{SERVING[l.serving] || l.serving}{l.path ? <> <code>{l.path}</code></> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="report-block">
        <h3>What sits in front of your site</h3>
        <dl className="kv">
          <div><dt>Front layer</dt><dd>{report.infra.layers.length ? report.infra.layers.join(', then ') : 'No CDN detected'}</dd></div>
          {report.infra.stack?.length ? (
            <div><dt>Full stack, outermost first</dt><dd>
              <ol className="stack">
                {report.infra.stack.map((s) => (
                  <li key={s.id}><span className="stack-name">{s.name}</span> <span className="stack-kind">{s.kindLabel}</span></li>
                ))}
              </ol>
            </dd></div>
          ) : null}
          <div><dt>How traffic flows</dt><dd>{PROXY_TYPE[report.infra.proxyType]}</dd></div>
          {report.infra.server ? <div><dt>Web server</dt><dd>{report.infra.server}</dd></div> : null}
          {report.infra.network ? <div><dt>Network of your address</dt><dd>{report.infra.network.label} (AS{report.infra.network.asn})</dd></div> : null}
          {report.infra.assetCdns?.length ? <div><dt>Asset CDN</dt><dd>{report.infra.assetCdns.map((a) => `${a.cdn} on ${a.host}`).join('; ')}</dd></div> : null}
          <div><dt>Platform</dt><dd>{report.platform.name || 'Not identified'}{report.platform.hosted ? ' (hosted)' : ''}</dd></div>
        </dl>
        {report.infra.signals.length ? (
          <details className="evidence">
            <summary>Show the evidence</summary>
            <ul>
              {report.infra.signals.map((s, i) => (
                <li key={i}>{s.check}: <code>{s.value}</code>{s.points_to ? ` points to ${s.points_to}` : ''}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      {!(report.verdict.status === 'implemented' && report.verdict.confidence === 'verified') ? (
        <div className="report-block">
          <h3>Your setup route</h3>
          <dl className="kv">
            <div><dt>Where it is configured</dt><dd>{report.route.label}</dd></div>
            <div><dt>Effort</dt><dd>{report.route.effort}</dd></div>
            {elig ? <div><dt>Eligibility</dt><dd>{elig.text}</dd></div> : null}
          </dl>
          <p>{report.route.note}</p>
        </div>
      ) : null}

      {report.warnings.length ? (
        <div className="report-block">
          <h3>Issues to fix</h3>
          <ul className="issues">
            {report.warnings.map((w) => (
              <li key={w.code}>{w.text}{w.ids?.length ? <> <span className="id-values">{w.ids.map((id) => <code key={id}>{id}</code>)}</span></> : null}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="next-step">
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <a className="btn-primary" href={bookUrl} target="_blank" rel="noopener noreferrer"
          onClick={() => track('gtg_call_clicked', { result_status: report.verdict.status, route: report.route.key })}>
          {step.cta}
        </a>
      </div>

      <p className="scan-meta">Checked {new Date(report.scannedAt).toLocaleString()}. We read the public home page only. Tags that load after cookie consent or on other pages may not appear.</p>
    </section>
  );
}
