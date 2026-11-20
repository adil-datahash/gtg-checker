'use client';

import { useEffect, useState } from 'react';
import { PRIVACY_URL } from '@/lib/client/copy.js';
import { track } from '@/lib/client/track.js';

const ROLES = ['Marketing', 'Developer / IT', 'Agency', 'Founder / Leadership', 'Other'];

function companyFromHost(host) {
  const parts = String(host || '').replace(/^www\./, '').split('.');
  const name = parts.length > 2 && parts[parts.length - 2].length <= 3 ? parts[parts.length - 3] : parts[0];
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : '';
}

function inside(summary) {
  if (summary.status === 'blocked' || summary.status === 'unconfirmed') {
    return ['A manual check of your site by our team', 'What sits in front of your domain and how to work with it', 'The setup route for your infrastructure'];
  }
  const list = [];
  if (summary.status === 'implemented' || summary.status === 'partial') list.push('Your gateway path and its health check result');
  list.push('Every Google tag ID on the page, and where each one loads from');
  list.push('How your CDN or server is set up, with the evidence we found');
  if (summary.status !== 'implemented' || summary.confidence !== 'verified') list.push('The setup route for your infrastructure, and how much work it is');
  if (summary.issueCount) list.push(`${summary.issueCount} ${summary.issueCount === 1 ? 'issue' : 'issues'} to fix, explained`);
  return list;
}

export default function ReportGate({ summary, onSubmit, busy, error }) {
  const [f, setF] = useState({ name: '', email: '', company: companyFromHost(summary.host), phone: '', role: '', consent: false });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  useEffect(() => { track('gtg_gate_viewed', { result_status: summary.status }); }, [summary.status]);

  function submit(e) {
    e.preventDefault();
    onSubmit({ ...f, name: f.name.trim(), email: f.email.trim(), company: f.company.trim(), phone: f.phone.trim() });
  }

  return (
    <section className="gate" aria-labelledby="gate-title">
      <div className="gate-inside">
        <h3 id="gate-title">{summary.status === 'blocked' || summary.status === 'unconfirmed' ? 'Get your site checked by hand' : 'Get the full report'}</h3>
        <p>We will show it here and email you a copy. It includes:</p>
        <ul>
          {inside(summary).map((x) => <li key={x}>{x}</li>)}
        </ul>
      </div>
      <form className="gate-form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="g-name">Full name</label>
          <input id="g-name" autoComplete="name" required value={f.name} onChange={set('name')} />
        </div>
        <div className="field">
          <label htmlFor="g-email">Work email</label>
          <input id="g-email" type="email" autoComplete="email" required value={f.email} onChange={set('email')} />
        </div>
        <div className="field">
          <label htmlFor="g-company">Company</label>
          <input id="g-company" autoComplete="organization" value={f.company} onChange={set('company')} />
        </div>
        <div className="field-pair">
          <div className="field">
            <label htmlFor="g-phone">Phone or WhatsApp <span className="opt">optional</span></label>
            <input id="g-phone" type="tel" autoComplete="tel" placeholder="+91 98765 43210" value={f.phone} onChange={set('phone')} />
          </div>
          <div className="field">
            <label htmlFor="g-role">Your role <span className="opt">optional</span></label>
            <select id="g-role" value={f.role} onChange={set('role')}>
              <option value="">Select</option>
              {ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <label className="consent">
          <input type="checkbox" checked={f.consent} onChange={set('consent')} />
          <span>
            Datahash can use these details to send this report and contact me about my tracking setup. We use your email
            domain and scan result to decide how to follow up. We never contact the owners of sites you scan. Unsubscribe
            at any time. <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">Privacy policy</a>
          </span>
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="btn-primary" type="submit" disabled={busy || !f.consent}>
          {busy ? 'Preparing your report' : summary.status === 'blocked' || summary.status === 'unconfirmed' ? 'Request a manual check' : 'Show my full report'}
        </button>
      </form>
    </section>
  );
}
