import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintInfra, recommendRoute } from '../detect.js';
import { PROVIDERS } from '../providers.js';

// One header fixture per provider (what that provider's responses typically carry).
const HEADER_FIXTURES = {
  sucuri: { 'x-sucuri-id': '18013', server: 'Sucuri/Cloudproxy' },
  imperva: { 'x-iinfo': '9-123-0 NNNN', 'set-cookie': 'visid_incap_123=abc; incap_ses_1_2=def' },
  reblaze: { server: 'Reblaze Secure Web Gateway', 'set-cookie': 'rbzid=abc' },
  myra: { server: 'myracloud' },
  radware: { 'x-rdwr-pop': 'fra' },
  ddos_guard: { server: 'ddos-guard' },
  qrator: { server: 'QRATOR' },
  f5_xc: { server: 'volt-adc' },
  fortiweb: { 'set-cookie': 'FORTIWAFSID=abc; path=/' },
  barracuda: { 'set-cookie': 'barra_counter_session=abc' },
  cloudflare: { 'cf-ray': '8a1b2c3d4e-BOM', server: 'cloudflare', 'cf-cache-status': 'DYNAMIC' },
  akamai: { 'server-timing': 'cdn-cache; desc=HIT, edge; dur=1, ak_p; desc="1"', 'akamai-grn': '0.1.2' },
  fastly: { 'x-served-by': 'cache-bom4732-BOM', 'x-timer': 'S1700000000.1,VS0,VE1', via: '1.1 varnish' },
  cloudfront: { 'x-amz-cf-id': 'abc==', 'x-amz-cf-pop': 'BOM78-P1', via: '1.1 abc.cloudfront.net (CloudFront)', 'x-cache': 'Hit from cloudfront' },
  azure_fd: { 'x-azure-ref': '20261110T0000Z-abc', 'x-fd-int-roxy-purgeid': '0' },
  azure_cdn: { 'x-msedge-ref': 'Ref A: abc' },
  google_cloud: { via: '1.1 google', 'alt-svc': 'h3=":443"' },
  bunny: { server: 'BunnyCDN-DE1-1052', 'cdn-pullzone': '12345', 'cdn-requestid': 'abc' },
  keycdn: { server: 'keycdn-engine', 'x-edge-location': 'inbo' },
  gcore: { server: 'gcore', 'x-gcore-cache': 'HIT' },
  cdn77: { server: 'CDN77-Turbo', 'x-77-cache': 'HIT' },
  cachefly: { server: 'CFS 0312', 'x-cf1': '123' },
  medianova: { server: 'MNCDN' },
  cdnetworks: { 'x-px': 'ht h0-s1.p11-bom.cdngp.net', server: 'CDNetworks' },
  tencent: { server: 'TencentEdgeOne', 'eo-log-uuid': 'abc' },
  alibaba: { eagleid: 'abc', 'x-swift-cachetime': '600', server: 'Tengine' },
  huawei: { server: 'HuaweiCloud CDN' },
  edgio: { server: 'ECAcc (bsa/1234)', 'x-ec-custom-error': '1' },
  stackpath: { 'x-hw': '1700000000.dop001.bo1.t,1700000000.cds001.bo1.c' },
  quic_cloud: { 'x-qc-cache': 'hit', 'x-qc-pop': 'AS-IN-BOM-1', server: 'LiteSpeed' },
  section: { 'section-io-id': 'abc' },
  hostinger_cdn: { server: 'hcdn', 'x-hcdn-request-id': 'abc' },
  kinsta: { 'ki-cache-type': 'None', 'x-kinsta-cache': 'HIT', 'cf-ray': 'abc-BOM', server: 'cloudflare' },
  wpengine: { 'x-powered-by': 'WP Engine', 'wpe-backend': 'apache', server: 'nginx' },
  pantheon: { 'x-pantheon-styx-hostname': 'styx1', 'x-served-by': 'cache-bom1-BOM', via: '1.1 varnish' },
  acquia: { 'x-ah-environment': 'prod', 'x-varnish': '123' },
  wpvip: { 'x-ac': '1.bom _dca HIT', 'x-rq': 'bom1', 'x-powered-by': 'WordPress VIP <https://wpvip.com>' },
  cloudways: { 'x-cloudways-cache': 'HIT', server: 'Apache' },
  aws_elb: { server: 'awselb/2.0', 'set-cookie': 'AWSALB=abc; AWSALBCORS=abc' },
  azure_appgw: { server: 'Microsoft-Azure-Application-Gateway/v2' },
  f5_bigip: { 'set-cookie': 'BIGipServerpool_web=123.456.0000' },
  citrix_adc: { 'set-cookie': 'NSC_web_vs=ffffffff0' },
  vercel: { server: 'Vercel', 'x-vercel-id': 'bom1::abc', 'x-vercel-cache': 'HIT' },
  netlify: { server: 'Netlify', 'x-nf-request-id': 'abc' },
  firebase: { 'x-served-by': 'firebase-hosting' },
  google_frontend: { server: 'Google Frontend', 'x-cloud-trace-context': 'abc' },
  heroku: { via: '1.1 vegur', server: 'Cowboy' },
  render: { 'rndr-id': 'abc', 'x-render-origin-server': 'uvicorn' },
  fly: { server: 'Fly/abc (2026-01-01)', 'fly-request-id': 'abc' },
  digitalocean_app: { 'x-do-app-origin': 'abc', 'x-do-orig-status': '200' },
  azure_app_service: { 'x-powered-by': 'ASP.NET', 'x-ms-request-id': 'abc', 'set-cookie': 'ARRAffinity=abc' },
  github_pages: { server: 'GitHub.com', 'x-github-request-id': 'ABC:123' },
  aws_s3: { server: 'AmazonS3' },
  varnish: { 'x-varnish': '32770 3', via: '1.1 varnish (Varnish/7.4)' },
  nginx: { server: 'nginx/1.24.0' },
  openresty: { server: 'openresty' },
  tengine: { server: 'Tengine/3.0' },
  apache: { server: 'Apache/2.4.58 (Ubuntu)' },
  iis: { server: 'Microsoft-IIS/10.0' },
  litespeed: { server: 'LiteSpeed' },
  caddy: { server: 'Caddy' },
  envoy: { server: 'envoy', 'x-envoy-upstream-service-time': '12' },
  haproxy: { server: 'HAProxy' },
  traefik: { server: 'Traefik' },
  tomcat: { server: 'Apache-Coyote/1.1' },
  node: { 'x-powered-by': 'Express' },
  kestrel: { server: 'Kestrel' },
  gunicorn: { server: 'gunicorn' }
};

// Providers with no reliable header: detected by DNS only.
const DNS_ONLY = { aws_amplify: 'main.d1abc.amplifyapp.com' };

test('every provider in the catalogue has a fixture', () => {
  for (const p of PROVIDERS) {
    assert.ok(HEADER_FIXTURES[p.id] || DNS_ONLY[p.id] || p.networkOnly, `missing fixture for ${p.id}`);
  }
});

for (const p of PROVIDERS) {
  const headers = HEADER_FIXTURES[p.id];
  if (!headers) continue;
  test(`detects ${p.name} from headers`, () => {
    const infra = fingerprintInfra(headers, []);
    assert.ok(infra.stack.some((s) => s.id === p.id), `${p.id} not in stack: ${JSON.stringify(infra.stack.map((s) => s.id))}`);
    const route = recommendRoute(infra, { name: null, hosted: false });
    assert.equal(route.key, p.id, `route for ${p.id} was ${route.key}`);
    assert.ok(['yes', 'conditional', 'limited'].includes(route.eligible));
    assert.ok(route.note.length > 20);
  });
}

// One CNAME per provider that has DNS patterns.
const CNAME_FIXTURES = {
  sucuri: 'www.example.com.sucuri.net', imperva: 'abc.x.incapdns.net', cloudflare: 'www.example.com.cdn.cloudflare.net',
  akamai: 'www.example.com.edgekey.net', fastly: 'example.map.fastly.net', cloudfront: 'd111abc.cloudfront.net',
  azure_fd: 'example-abc.z01.azurefd.net', azure_cdn: 'example.azureedge.net', bunny: 'example.b-cdn.net',
  keycdn: 'example-1a2b.kxcdn.com', gcore: 'cl-abc.gcdn.co', cdn77: '1234567.rsc.cdn77.org', cachefly: 'example.cachefly.net',
  medianova: 'example.mncdn.com', cdnetworks: 'example.cdngc.net', tencent: 'example.com.eo.dnse3.com', alibaba: 'example.w.alikunlun.com',
  huawei: 'example.c.cdnhwc1.com', edgio: 'wac.1234.edgecastcdn.net', stackpath: 'abc.stackpathcdn.com', kinsta: 'example.hosting.kinsta.cloud',
  wpengine: 'example.wpengine.com', pantheon: 'live-example.pantheonsite.io', acquia: 'example.prod.acquia-sites.com',
  aws_elb: 'my-alb-123.ap-south-1.elb.amazonaws.com', vercel: 'cname.vercel-dns.com', netlify: 'example.netlify.app',
  aws_amplify: 'main.d1abc.amplifyapp.com', firebase: 'example.web.app', heroku: 'example.herokudns.com', render: 'example.onrender.com',
  fly: 'example.fly.dev', digitalocean_app: 'example-abc.ondigitalocean.app', azure_app_service: 'example.azurewebsites.net',
  github_pages: 'example.github.io', hostinger_cdn: 'example.cdn.hstgr.net'
};

for (const [id, cname] of Object.entries(CNAME_FIXTURES)) {
  test(`detects ${id} from DNS CNAME ${cname}`, () => {
    const infra = fingerprintInfra({}, [cname + '.']);
    assert.equal(infra.primaryId, id);
    assert.ok(infra.signals.some((s) => s.check === 'DNS CNAME' && s.points_to));
  });
}

test('security proxy in front of a CDN is the outer layer', () => {
  const infra = fingerprintInfra({ 'x-sucuri-id': '1', 'x-amz-cf-id': 'abc' }, []);
  assert.equal(infra.primaryId, 'sucuri');
  assert.deepEqual(infra.layers, ['Sucuri', 'Amazon CloudFront']);
});

test('Cloudflare in front of Vercel routes to Cloudflare', () => {
  const infra = fingerprintInfra({ 'cf-ray': 'x', server: 'cloudflare', 'x-vercel-id': 'abc' }, []);
  assert.equal(infra.primaryId, 'cloudflare');
  assert.equal(recommendRoute(infra, {}).key, 'cloudflare');
});

test('Kinsta owns its Cloudflare edge, so the route goes through Kinsta', () => {
  const infra = fingerprintInfra(HEADER_FIXTURES.kinsta, []);
  assert.equal(infra.primaryId, 'cloudflare');
  assert.equal(recommendRoute(infra, {}).key, 'kinsta');
});

test('Pantheon owns its Fastly edge, so the route goes through Pantheon', () => {
  const infra = fingerprintInfra(HEADER_FIXTURES.pantheon, []);
  assert.equal(recommendRoute(infra, {}).key, 'pantheon');
});

test('earlier CNAME in the chain wins between two CDNs', () => {
  const infra = fingerprintInfra({}, ['www.example.com.edgekey.net', 'd1.cloudfront.net']);
  assert.equal(infra.primaryId, 'akamai');
});

test('plain Fastly is not mistaken for generic Varnish', () => {
  const infra = fingerprintInfra(HEADER_FIXTURES.fastly, []);
  assert.equal(infra.primaryId, 'fastly');
});

test('Apache-Coyote is Tomcat, not Apache', () => {
  const infra = fingerprintInfra({ server: 'Apache-Coyote/1.1' }, []);
  assert.equal(infra.server, 'Apache Tomcat / Java server');
});

test('nothing exposed gives an unknown route', () => {
  const infra = fingerprintInfra({ 'content-type': 'text/html' }, []);
  assert.equal(infra.proxyType, 'unknown');
  assert.equal(recommendRoute(infra, {}).key, 'unknown');
});

test('GitHub Pages on Fastly routes to GitHub Pages (Limited), not Fastly', () => {
  const infra = fingerprintInfra({ server: 'GitHub.com', 'x-github-request-id': 'A:B', 'x-served-by': 'cache-bom4732-BOM', via: '1.1 varnish' }, []);
  assert.equal(infra.primaryId, 'fastly');
  const route = recommendRoute(infra, {});
  assert.equal(route.key, 'github_pages');
  assert.equal(route.eligible, 'limited');
});

// ---------- network (ASN) ----------
import { classifyNetwork, orgName } from '../networks.js';

// Real names from live lookups (20 Nov 2026).
const LIVE = {
  'gcore.com': ['199524', 'GCORE - G-Core Labs S.A., LU', 'gcore'],
  'qrator.net': ['209671', 'QRATOR-SW - Qrator Labs CZ s.r.o., CZ', 'qrator'],
  'fastly.com': ['54113', 'FASTLY - Fastly, Inc., US', 'fastly'],
  'www.akamai.com': ['20940', 'AKAMAI-ASN1 - Akamai International B.V., NL', 'akamai'],
  'bunny.net': ['200325', 'BunnyCDN - BUNNYWAY, informacijske storitve d.o.o., SI', 'bunny'],
  'imperva.com': ['19551', 'INCAPSULA - Incapsula Inc, US', 'imperva'],
  'sucuri.net': ['30148', 'SUCURI-SEC - Sucuri, US', 'sucuri'],
  'cachefly.com': ['30081', 'CACHENETWORKS - CacheFly, US', 'cachefly'],
  'medianova.com': ['21245', 'Medianova - MEDIANOVA INTERNET HIZMETLERI VE TICARET ANONIM SIRKETI, TR', 'medianova'],
  'reblaze.com': ['34309', 'LINK11 - Link11 GmbH, DE', 'link11'],
  'fly.io': ['40509', 'FLY - Fly.io, Inc., US', 'fly'],
  'render.com': ['397273', 'RENDER - Render, US', 'render'],
  'kinsta.com': ['13335', 'CLOUDFLARENET - Cloudflare, Inc., US', 'cloudflare']
};
for (const [site, [asn, name, id]] of Object.entries(LIVE)) {
  test(`network ${name.split(' ')[0]} (${site}) -> ${id}`, () => {
    const infra = fingerprintInfra({}, [], [], { asn, name });
    assert.equal(infra.primaryId, id);
    assert.ok(infra.signals.some((s) => s.check === 'IP network' && s.points_to));
  });
}

test('hosting networks are shown, not treated as a CDN', () => {
  for (const [name, label] of [['AMAZON-02 - Amazon.com, Inc., US', 'Amazon Web Services'], ['DIGITALOCEAN-ASN - DigitalOcean, LLC, US', 'DigitalOcean'],
    ['AS-VULTR - The Constant Company, LLC, US', 'Vultr'], ['GOOGLE - Google LLC, US', 'Google Cloud'], ['AUTOMATTIC - Automattic, Inc, US', 'Automattic (WordPress.com / VIP)'],
    ['AKAMAI-LINODE-AP - Akamai Connected Cloud, SG', 'Akamai Cloud (Linode)']]) {
    const infra = fingerprintInfra({}, [], [], { asn: '1', name });
    assert.equal(infra.primary, null, name);
    assert.equal(infra.network.label, label);
    assert.equal(infra.proxyType, 'origin_direct');
    const route = recommendRoute(infra, {});
    assert.equal(route.key, 'web_server');
    assert.match(route.note, new RegExp(label.replace(/[()]/g, '.')));
  }
});

test('unknown network keeps its organisation name', () => {
  assert.equal(orgName('SOPRADO-ANY - SOPRADO GmbH, DE'), 'SOPRADO GmbH');
  assert.equal(classifyNetwork({ asn: '20546', name: 'SOPRADO-ANY - SOPRADO GmbH, DE' }).label, 'SOPRADO GmbH');
});

test('headers still win over the hosting network: CloudFront on Amazon addresses', () => {
  const infra = fingerprintInfra({ 'x-amz-cf-id': 'a', 'x-amz-cf-pop': 'BOM' }, [], [], { asn: '16509', name: 'AMAZON-02 - Amazon.com, Inc., US' });
  assert.equal(infra.primary, 'Amazon CloudFront');
});
