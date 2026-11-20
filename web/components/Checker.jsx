'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { scanSite, submitLead } from '@/lib/client/api.js';
import { track, readUtm } from '@/lib/client/track.js';
import RoutePath from './RoutePath.jsx';
import ScanProgress from './ScanProgress.jsx';
import Verdict from './Verdict.jsx';
import ReportGate from './ReportGate.jsx';
import FullReport from './FullReport.jsx';
import Turnstile, { TURNSTILE_ON } from './Turnstile.jsx';

function displayHost(input) {
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { return new URL(s).hostname; } catch { return input.trim(); }
}

function pathState(status) {
  if (status === 'implemented') return 'gateway';
  if (status === 'partial') return 'partial';
  if (status === 'not_implemented') return 'direct';
  return 'idle';
}

export default function Checker() {
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | scanning | result | error
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);
  const [report, setReport] = useState(null);
  const [dryRun, setDryRun] = useState(false);
  const [gateBusy, setGateBusy] = useState(false);
  const [gateError, setGateError] = useState('');
  const [token, setToken] = useState('');
  const scannedUrl = useRef('');
  const resultRef = useRef(null);
  const onToken = useCallback((t) => setToken(t), []);

  // Prefill from ?url= so the tool can be linked to with a site already filled in.
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('url');
      if (q) setUrl(q.slice(0, 200));
    } catch {}
  }, []);

  useEffect(() => {
    if (phase === 'result' && resultRef.current) resultRef.current.focus({ preventScroll: false });
  }, [phase]);

  async function runScan(e) {
    e.preventDefault();
    if (!url.trim()) { setError('Enter your website address, like yourbrand.com.'); setPhase('error'); return; }
    if (TURNSTILE_ON && !token) { setError('Complete the human check, then try again.'); setPhase('error'); return; }
    setError(''); setSummary(null); setReport(null); setGateError('');
    scannedUrl.current = url.trim();
    setPhase('scanning');
    track('gtg_scan_started');
    try {
      const data = await scanSite(scannedUrl.current, token);
      setSummary(data.summary);
      setPhase('result');
      track('gtg_scan_completed', { result_status: data.summary.status, cdn: data.summary.cdn || 'none', gateway_on: data.summary.gtgServedBy || 'none', eligible: data.summary.eligible });
    } catch (err) {
      setError(err.message || 'Something went wrong. Try again in a minute.');
      setPhase('error');
      track('gtg_scan_failed', { error_code: err.code || 'unknown' });
    }
  }

  async function unlock(lead) {
    setGateBusy(true); setGateError('');
    try {
      const data = await submitLead({ url: scannedUrl.current, lead, utm: readUtm() });
      setReport(data.report);
      setDryRun(Boolean(data.dryRun));
      track('gtg_lead_submitted', { result_status: data.report.verdict.status, route: data.report.route.key });
    } catch (err) {
      setGateError(err.message || 'We could not save your details. Try again in a minute.');
    } finally {
      setGateBusy(false);
    }
  }

  function reset() {
    setPhase('idle'); setSummary(null); setReport(null); setUrl(''); setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const gatewayPath = report?.gtg?.path || report?.verdict?.gtgPaths?.[0];

  return (
    <>
      <section className="hero">
        <h1>Do your Google tags load from your own domain?</h1>
        <p className="lede">
          Google tag gateway serves your Google tags through your website instead of googletagmanager.com, so ad blockers
          and privacy browsers cut less of your conversion data. Check whether a site has it, what it runs on, and which
          CDN serves the gateway.
        </p>
        <form className="scan-form" onSubmit={runScan} noValidate>
          <label htmlFor="site-url" className="sr-only">Website address</label>
          <input
            id="site-url"
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck="false"
            placeholder="yourbrand.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={phase === 'scanning'}
          />
          <button className="btn-primary" type="submit" disabled={phase === 'scanning'}>
            {phase === 'scanning' ? 'Checking' : 'Check my site'}
          </button>
        </form>
        <Turnstile onToken={onToken} />
        {phase === 'error' ? <p className="form-error" role="alert">{error}</p> : null}
        <p className="hint">Free. Takes about 10 seconds. We only read public pages.</p>
      </section>

      {phase === 'scanning' ? <ScanProgress host={displayHost(scannedUrl.current)} /> : null}

      {phase === 'result' && summary ? (
        <div className="results" ref={resultRef} tabIndex={-1}>
          <Verdict summary={summary} onReset={reset} />
          <section className="diagram-panel" aria-label="How your Google tags load">
            <RoutePath state={pathState(summary.status)} host={summary.host} cdn={summary.gtgServedBy || summary.cdn} path={gatewayPath} />
          </section>
          {report ? <FullReport report={report} dryRun={dryRun} /> : <ReportGate summary={summary} onSubmit={unlock} busy={gateBusy} error={gateError} />}
        </div>
      ) : phase !== 'scanning' ? (
        <section className="diagram-panel" aria-label="How Google tags load, with and without a gateway">
          <RoutePath state="idle" />
        </section>
      ) : null}
    </>
  );
}
