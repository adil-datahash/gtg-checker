'use client';

import { verdictCopy, ELIGIBILITY } from '@/lib/client/copy.js';

const CHECKED_BY = {
  browser_run: 'Checked in a real browser, with the cookie banner accepted.',
  visitor_browser: 'Checked in your own browser with the browser check.'
};

export default function Verdict({ summary, onReset }) {
  const v = verdictCopy(summary);
  const elig = ELIGIBILITY[summary.eligible];
  const showElig = summary.status !== 'implemented' && elig;
  return (
    <section className={`verdict tone-${v.tone}`} aria-live="polite">
      <div className="verdict-head">
        <p className="verdict-site mono">{summary.host}</p>
        <h2>{v.title}</h2>
        <p className="verdict-body">{v.body}</p>
        {CHECKED_BY[summary.checkedBy] ? <p className="checked-by">{CHECKED_BY[summary.checkedBy]}</p> : null}
      </div>
      <dl className="facts">
        {summary.gtgServedBy ? (
          <div>
            <dt>Gateway runs on</dt>
            <dd className="elig-yes">{summary.gtgServedBy}</dd>
          </div>
        ) : null}
        <div>
          <dt>CDN in front of your site</dt>
          <dd>{summary.cdn || (summary.hostedOn ? 'None found' : 'Not identified')}</dd>
        </div>
        {summary.hostedOn ? (
          <div>
            <dt>Hosted on</dt>
            <dd>{summary.hostedOn}</dd>
          </div>
        ) : null}
        <div>
          <dt>Platform</dt>
          <dd>{summary.platform || 'Not identified'}</dd>
        </div>
        {showElig ? (
          <div>
            <dt>Gateway setup</dt>
            <dd className={`elig elig-${summary.eligible}`}>{elig.label}</dd>
          </div>
        ) : null}
        {summary.tagManagers?.length ? (
          <div>
            <dt>Tag manager</dt>
            <dd>{summary.tagManagers.join(', ')}</dd>
          </div>
        ) : null}
        {summary.consentBanner ? (
          <div>
            <dt>Cookie banner</dt>
            <dd>{summary.consentBanner}</dd>
          </div>
        ) : null}
        <div>
          <dt>Google tags found</dt>
          <dd>{summary.tagCount}</dd>
        </div>
        <div>
          <dt>Issues found</dt>
          <dd>{summary.issueCount}</dd>
        </div>
      </dl>
      <button type="button" className="link-button" onClick={onReset}>Check another site</button>
    </section>
  );
}
