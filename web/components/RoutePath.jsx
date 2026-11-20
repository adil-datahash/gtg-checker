'use client';

// The tag request path: how a visitor's browser reaches Google's tags.
// One lane through the site's own domain (gateway), one lane straight to Google.

function Node({ title, sub, mono, kind }) {
  return (
    <div className={`rp-node ${kind || ''}`}>
      <span className="rp-node-title">{title}</span>
      {sub ? <span className={`rp-node-sub ${mono ? 'mono' : ''}`}>{sub}</span> : null}
    </div>
  );
}

function Wire({ broken, delay = 0 }) {
  return (
    <div className={`rp-wire ${broken ? 'broken' : ''}`} style={{ '--d': `${delay}ms` }} aria-hidden="true">
      <span className="rp-line" />
      {broken ? <span className="rp-break">Often blocked</span> : null}
    </div>
  );
}

export default function RoutePath({ state = 'idle', host, cdn, path }) {
  const site = host || 'yourwebsite.com';
  const gatewayOn = state === 'idle' || state === 'gateway' || state === 'partial';
  const directOn = state === 'idle' || state === 'direct' || state === 'partial';
  const key = `${state}-${host || ''}`; // replays the draw-in when the result changes

  return (
    <figure className={`route-path state-${state}`} key={key}>
      <div className={`rp-lane ${gatewayOn ? 'on' : 'off'} gateway`}>
        <p className="rp-caption">
          {state === 'direct' ? 'With Google tag gateway, tags would load through your domain' : 'Through your own domain, with Google tag gateway'}
        </p>
        <div className="rp-row">
          <Node title="Visitor's browser" />
          <Wire delay={0} />
          <Node title={cdn || 'Your CDN or server'} sub="Forwards the tag request" />
          <Wire delay={180} />
          <Node title={site} sub={path || '/your-path/'} mono kind="own" />
          <Wire delay={360} />
          <Node title="Google" sub="Tags and measurement" />
        </div>
      </div>
      <div className={`rp-lane ${directOn ? 'on' : 'off'} direct`}>
        <p className="rp-caption">{state === 'gateway' ? 'Before: tags loaded straight from Google' : 'Straight to Google, without a gateway'}</p>
        <div className="rp-row">
          <Node title="Visitor's browser" />
          <Wire broken delay={0} />
          <Node title="googletagmanager.com" sub="Third-party domain" mono kind="third" />
        </div>
      </div>
      <figcaption className="sr-only">
        Diagram comparing tags loaded through {site} with tags loaded directly from googletagmanager.com.
      </figcaption>
    </figure>
  );
}
