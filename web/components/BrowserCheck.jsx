// 'use client';

// import { useEffect, useRef, useState } from 'react';
// import probe from '@/lib/client/probe.json';
// import { track } from '@/lib/client/track.js';

// // Shown when our servers could not settle the answer (the site blocked them, or the tag did not show).
// // The visitor runs the same check in their own browser, which their site lets in.
// export default function BrowserCheck({ summary }) {
//   const linkRef = useRef(null);
//   const [copied, setCopied] = useState('');
//   const [script, setScript] = useState('');

//   useEffect(() => {
//     const here = window.location.origin + window.location.pathname;
//     const s = probe.source.replace('__REPORT_URL__', here);
//     setScript(s);
//     // React refuses javascript: links in JSX, so the bookmarklet address is set directly.
//     if (linkRef.current) linkRef.current.setAttribute('href', 'javascript:' + encodeURIComponent(s));
//   }, []);

//   async function copy() {
//     try {
//       await navigator.clipboard.writeText(script);
//       setCopied('Copied. Paste it into the Console on your site and press Enter.');
//     } catch {
//       setCopied('Copy did not work here. Select the text below and copy it.');
//     }
//     track('gtg_browser_check_copied', { reason: summary.status });
//   }

//   const why = summary.status === 'blocked'
//     ? summary.browserBlocked
//       ? 'Your site blocks automated checks, including our real-browser check. Your own browser gets in, so the check can run there.'
//       : 'Your site blocks automated checks. Your own browser gets in, so the check can run there.'
//     : 'Some Google tags load only on certain pages or after cookies are accepted. Running the check in your own browser sees exactly what your visitors get.';

//   return (
//     <section className="browser-check" aria-labelledby="browser-check-title">
//       <h3 id="browser-check-title">Check from your browser</h3>
//       <p>{why} It takes about 10 seconds and finds your Google tags whatever loads them: Google Tag Manager, Tealium, Adobe Launch or code on the page.</p>

//       <h4 className="subhead">Option 1: the bookmark button</h4>
//       <ol className="steps">
//         <li>Drag this button to your bookmarks bar: <a ref={linkRef} className="bookmarklet" href="#browser-check-title" onClick={(e) => e.preventDefault()} draggable="true">GTG check</a></li>
//         <li>Open <strong>{summary.host}</strong> in this browser.</li>
//         <li>Click <strong>GTG check</strong> in your bookmarks bar, then choose whether it may accept cookies for the test.</li>
//         <li>Press <strong>See the full report</strong> to bring the result back here.</li>
//       </ol>
//       <p className="hint">If nothing happens when you click it, your site&apos;s security settings block bookmark buttons. Use option 2.</p>

//       <h4 className="subhead">Option 2: paste into the browser console</h4>
//       <ol className="steps">
//         <li>Open <strong>{summary.host}</strong>, then press <kbd>F12</kbd> (on a Mac, <kbd>Cmd</kbd>+<kbd>Option</kbd>+<kbd>J</kbd>) and open <strong>Console</strong>.</li>
//         <li><button type="button" className="btn-secondary" onClick={copy} disabled={!script}>Copy the check</button> then paste it into the Console and press Enter. Chrome may ask you to type &quot;allow pasting&quot; first.</li>
//       </ol>
//       {copied ? <p className="hint" role="status">{copied}</p> : null}
//       <details className="evidence">
//         <summary>What the check does</summary>
//         <ul>
//           <li>Reads which Google tag requests the page made and whether they went to your domain or to Google.</li>
//           <li>Calls the gateway health check (<code>/&lt;path&gt;/healthy</code>) on your domain.</li>
//           <li>Names your tag manager and cookie banner, and reads Google Consent Mode settings.</li>
//           <li>Accepts all cookies only if you choose that. You can change it back in your site&apos;s cookie settings.</li>
//           <li>Sends nothing anywhere until you press See the full report, and then only the tag findings, no personal data.</li>
//         </ul>
//       </details>
//     </section>
//   );
// }


'use client';

import { useEffect, useRef } from 'react';
import probe from '@/lib/client/probe.json';
import { track } from '@/lib/client/track.js';

// Shown when our servers could not settle the answer (the site blocked them, or the tag did not show).
// The visitor runs the same check in their own browser, which their site lets in.
// A web page cannot run code on another website (browsers forbid it), so the visitor clicks the
// bookmark button on their own site: one click after the site opens.
export default function BrowserCheck({ summary }) {
  const linkRef = useRef(null);

  useEffect(() => {
    const here = window.location.origin + window.location.pathname;
    const s = probe.source.replace('__REPORT_URL__', here);
    // React refuses javascript: links in JSX, so the bookmark button's address is set directly.
    if (linkRef.current) linkRef.current.setAttribute('href', 'javascript:' + encodeURIComponent(s));
  }, []);

  function openSite() {
    track('gtg_browser_check_open_site', { reason: summary.status });
    window.open(`https://${summary.host}/`, '_blank', 'noopener');
  }

  const why = summary.status === 'blocked'
    ? summary.browserBlocked
      ? 'Your site blocks automated checks, including our real-browser check. Your own browser gets in, so the check can run there.'
      : 'Your site blocks automated checks. Your own browser gets in, so the check can run there.'
    : 'Some Google tags load only on certain pages or after cookies are accepted. Running the check in your own browser sees exactly what your visitors get.';

  return (
    <section className="browser-check" aria-labelledby="browser-check-title">
      <h3 id="browser-check-title">Check from your browser</h3>
      <p>{why} It takes about 10 seconds and finds your Google tags whatever loads them: Google Tag Manager, Tealium, Adobe Launch or code on the page.</p>
      <ol className="steps">
        <li>Drag this button to your bookmarks bar (once): <a ref={linkRef} className="bookmarklet" href="#browser-check-title" onClick={(e) => e.preventDefault()} draggable="true">GTG check</a></li>
        <li><button type="button" className="btn-secondary" onClick={openSite}>Open {summary.host}</button></li>
        <li>On your site, click <strong>GTG check</strong> in the bookmarks bar and choose whether it may accept cookies for the test.</li>
        <li>Press <strong>See the full report</strong> to bring the result back here.</li>
      </ol>
      <p className="hint">Bookmarks bar hidden? Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> (on a Mac, <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>). If nothing happens when you click it, your site&apos;s security settings block bookmark buttons: ask us for a manual check below.</p>
      <details className="evidence">
        <summary>What the check does</summary>
        <ul>
          <li>Reads which Google tag requests the page made and whether they went to your domain or to Google.</li>
          <li>Calls the gateway health check (<code>/&lt;path&gt;/healthy</code>) on your domain.</li>
          <li>Names your tag manager and cookie banner, and reads Google Consent Mode settings.</li>
          <li>Accepts all cookies only if you choose that. You can change it back in your site&apos;s cookie settings.</li>
          <li>Sends nothing anywhere until you press See the full report, and then only the tag findings, no personal data.</li>
        </ul>
      </details>
    </section>
  );
}
