// Every infrastructure provider the checker recognises, as data.
// To add a provider: add one entry. Nothing else in the engine needs to change.
//
// kind decides layering when several are found (outermost first):
//   security  - WAF / DDoS proxy that usually sits in front of everything
//   cdn       - CDN / edge network
//   managed   - managed host that owns the edge for you (Kinsta, WP Engine...)
//   lb        - cloud load balancer / application gateway
//   paas      - app hosting platform
//   origin    - web server software
//
// test(h, cookies)  h = lowercased response headers, cookies = raw set-cookie string
// cnames            regexes matched against the DNS CNAME chain of the host
// route             how Google tag gateway would be configured on this layer
//   eligible: yes | conditional | limited
//
// Signatures come from public response-header and DNS conventions of each provider.

const has = (h, ...names) => names.some((n) => h[n] !== undefined);
const prefix = (h, p) => Object.keys(h).some((k) => k.startsWith(p));
const m = (v, re) => re.test(v || '');

export const KIND_ORDER = ['security', 'cdn', 'managed', 'lb', 'paas', 'origin'];

export const KIND_LABEL = {
  security: 'Security proxy / WAF',
  cdn: 'CDN',
  managed: 'Managed hosting',
  lb: 'Load balancer',
  paas: 'App hosting',
  origin: 'Web server'
};

const edge = (label, effort, note, eligible = 'yes') => ({ label, effort, note, eligible });

export const PROVIDERS = [
  // ---------- Security proxies / WAFs ----------
  {
    id: 'sucuri', name: 'Sucuri', kind: 'security',
    test: (h) => has(h, 'x-sucuri-id', 'x-sucuri-cache') || m(h.server, /sucuri|cloudproxy/i),
    cnames: [/\.sucuri\.net$/i],
    route: edge('Sucuri firewall', 'Medium', 'Sucuri sits in front of your site, so the path rule is added through Sucuri support. Custom routing depends on your plan.', 'conditional')
  },
  {
    id: 'imperva', name: 'Imperva (Incapsula)', kind: 'security',
    test: (h, c) => has(h, 'x-iinfo') || m(h['x-cdn'], /imperva|incapsula/i) || m(c, /incap_ses|visid_incap/i),
    cnames: [/\.incapdns\.net$/i, /\.impervadns\.net$/i],
    route: edge('Imperva Cloud WAF', 'Medium', 'Add a site rule that forwards the measurement path to Google, or ask your Imperva account team to add it.', 'conditional')
  },
  {
    id: 'link11', name: 'Link11', kind: 'security', networkOnly: true,
    test: () => false, // recognised from its network (ASN), not from headers
    cnames: [],
    route: edge('Link11', 'Medium', 'Link11 sits in front of your site. Path routing to Google is set up through Link11, or on the server behind it.', 'conditional')
  },
  {
    id: 'reblaze', name: 'Reblaze', kind: 'security',
    test: (h, c) => m(h.server, /reblaze/i) || m(c, /rbzid/i),
    cnames: [/\.reblaze\.(com|io)$/i],
    route: edge('Reblaze', 'Medium', 'Path routing to an external origin is configured by Reblaze support for your site.', 'conditional')
  },
  {
    id: 'myra', name: 'Myra Security', kind: 'security',
    test: (h) => m(h.server, /myracloud/i) || prefix(h, 'x-myra'),
    cnames: [/\.myracloud\.com$/i, /\.myrasecurity\.com$/i],
    route: edge('Myra Security', 'Medium', 'Add an upstream for the measurement path in the Myra dashboard, or through Myra support.', 'conditional')
  },
  {
    id: 'radware', name: 'Radware Cloud WAF', kind: 'security',
    test: (h) => prefix(h, 'x-rdwr'),
    cnames: [/\.radwarecloud\.(com|net)$/i],
    route: edge('Radware Cloud WAF', 'Medium', 'Path routing is set up through Radware, usually with their support team.', 'conditional')
  },
  {
    id: 'ddos_guard', name: 'DDoS-Guard', kind: 'security',
    test: (h, c) => m(h.server, /ddos-guard/i) || m(c, /__ddg\d/i),
    cnames: [/\.ddos-guard\.net$/i],
    route: edge('DDoS-Guard', 'Medium', 'Custom path routing depends on your DDoS-Guard plan. The rule can also go on your web server behind it.', 'conditional')
  },
  {
    id: 'qrator', name: 'Qrator', kind: 'security',
    test: (h) => m(h.server, /qrator/i),
    cnames: [/\.qrator\.net$/i],
    route: edge('Qrator', 'Medium', 'Qrator passes traffic to your servers, so the path rule usually goes on the web server behind it.', 'conditional')
  },
  {
    id: 'f5_xc', name: 'F5 Distributed Cloud', kind: 'security',
    test: (h) => m(h.server, /volt-adc/i),
    cnames: [/\.(vh|ves)\.volterra\.(io|us)$/i],
    route: edge('F5 Distributed Cloud', 'Medium', 'Add an origin pool for Google and a route for the measurement path on your HTTP load balancer.')
  },
  {
    id: 'fortiweb', name: 'Fortinet FortiWeb', kind: 'security',
    test: (h, c) => m(c, /FORTIWAFSID/i),
    cnames: [/\.fortiweb-cloud\.com$/i],
    route: edge('FortiWeb', 'Medium', 'The path is usually forwarded on the web server or load balancer behind FortiWeb.', 'conditional')
  },
  {
    id: 'barracuda', name: 'Barracuda WAF', kind: 'security',
    test: (h, c) => m(c, /barra_counter_session|BNI__BARRACUDA/i),
    cnames: [/\.barracudanetworks\.com$/i],
    route: edge('Barracuda WAF', 'Medium', 'The path is usually forwarded on the web server or load balancer behind Barracuda.', 'conditional')
  },

  // ---------- CDNs / edge networks ----------
  {
    id: 'cloudflare', name: 'Cloudflare', kind: 'cdn',
    test: (h) => has(h, 'cf-ray', 'cf-cache-status') || m(h.server, /^cloudflare/i),
    cnames: [/\.cdn\.cloudflare\.net$/i, /\.pages\.dev$/i, /\.workers\.dev$/i],
    route: edge('Cloudflare', 'Low', 'Cloudflare can serve Google tags through its built-in tag gateway option or a proxy rule. Usually the fastest route.')
  },
  {
    id: 'akamai', name: 'Akamai', kind: 'cdn',
    test: (h) => m(h.server, /akamai/i) || has(h, 'akamai-grn', 'akamai-cache-status', 'akamai-request-bc') || prefix(h, 'x-akamai-') ||
      m(h['x-cache'], /akamaitechnologies|from a\d+-\d+/i) || m(h['server-timing'], /\bak_p\b/),
    cnames: [/\.(edgekey|edgesuite|akamaiedge|akamaized|akamai|akamaihd|akadns|akamaitechnologies)\.net$/i],
    route: edge('Akamai Property Manager', 'Medium', 'Needs a new origin and path rule in Akamai Property Manager, plus access to the property.')
  },
  {
    id: 'fastly', name: 'Fastly', kind: 'cdn',
    test: (h) => has(h, 'x-fastly-request-id', 'fastly-restarts') || prefix(h, 'fastly-') ||
      m(h['x-served-by'], /cache-[a-z]{3,4}\d+/i) || m(h['x-timer'], /^S\d+\.\d+,VS\d/),
    cnames: [/\.(fastly|fastlylb)\.net$/i, /\.global\.ssl\.fastly\.net$/i],
    route: edge('Fastly', 'Medium', 'Needs a backend for Google and a VCL or Compute rule that routes the measurement path to it.')
  },
  {
    id: 'cloudfront', name: 'Amazon CloudFront', kind: 'cdn',
    test: (h) => has(h, 'x-amz-cf-id', 'x-amz-cf-pop') || m(h.via, /cloudfront/i) || m(h['x-cache'], /cloudfront/i),
    cnames: [/\.cloudfront\.net$/i],
    route: edge('Amazon CloudFront', 'Medium', 'Needs a new origin and cache behaviour for the measurement path in your CloudFront distribution.')
  },
  {
    id: 'azure_fd', name: 'Azure Front Door', kind: 'cdn',
    test: (h) => has(h, 'x-azure-ref', 'x-azure-ref-originshield', 'x-fd-healthprobe') || prefix(h, 'x-fd-'),
    cnames: [/\.(azurefd|afd)\.net$/i, /\.z\d+\.azurefd\.net$/i],
    route: edge('Azure Front Door', 'Medium', 'Needs an origin group for Google and a route for the measurement path.')
  },
  {
    id: 'azure_cdn', name: 'Azure CDN', kind: 'cdn',
    test: (h) => has(h, 'x-msedge-ref'),
    cnames: [/\.azureedge\.net$/i, /\.vo\.msecnd\.net$/i],
    route: edge('Azure CDN', 'Medium', 'Classic Azure CDN cannot route a path to a separate origin. Moving the domain to Azure Front Door is the usual route.', 'conditional')
  },
  {
    id: 'google_cloud', name: 'Google Cloud Load Balancer / Cloud CDN', kind: 'lb',
    test: (h) => m(h.via, /\b1\.1 google\b/i),
    cnames: [], // Google Cloud load balancers use A records, so headers are the signal
    route: edge('Google Cloud Load Balancer', 'Medium', 'Needs an internet network endpoint group for Google and a path rule on your load balancer.')
  },
  {
    id: 'bunny', name: 'Bunny CDN', kind: 'cdn',
    test: (h) => m(h.server, /bunnycdn/i) || has(h, 'cdn-pullzone', 'cdn-requestid', 'cdn-uid'),
    cnames: [/\.b-cdn\.net$/i, /\.bunnycdn\.com$/i],
    route: edge('Bunny CDN', 'Medium', 'Needs an edge rule that routes the measurement path to Google with the right Host header.')
  },
  {
    id: 'keycdn', name: 'KeyCDN', kind: 'cdn',
    test: (h) => m(h.server, /keycdn/i),
    cnames: [/\.kxcdn\.com$/i],
    route: edge('KeyCDN', 'Medium', 'KeyCDN pull zones serve one origin, so the path rule usually goes on your web server.', 'conditional')
  },
  {
    id: 'gcore', name: 'Gcore', kind: 'cdn',
    test: (h) => m(h.server, /gcore/i) || prefix(h, 'x-gcore'),
    cnames: [/\.gcdn\.co$/i, /\.gcorelabs\.net$/i],
    route: edge('Gcore CDN', 'Medium', 'Add a rule for the measurement path that sends it to Google as a separate origin.')
  },
  {
    id: 'cdn77', name: 'CDN77', kind: 'cdn',
    test: (h) => m(h.server, /cdn77/i) || prefix(h, 'x-77-'),
    cnames: [/\.cdn77\.(org|net)$/i],
    route: edge('CDN77', 'Medium', 'Path routing to a second origin is set up with CDN77 support.', 'conditional')
  },
  {
    id: 'cachefly', name: 'CacheFly', kind: 'cdn',
    test: (h) => m(h.server, /^cfs\b/i) || has(h, 'x-cf1', 'x-cf2'),
    cnames: [/\.cachefly\.net$/i],
    route: edge('CacheFly', 'Medium', 'Path routing to a second origin is set up with CacheFly support.', 'conditional')
  },
  {
    id: 'medianova', name: 'Medianova', kind: 'cdn',
    test: (h) => m(h.server, /mncdn|medianova/i),
    cnames: [/\.mncdn\.(com|net)$/i],
    route: edge('Medianova', 'Medium', 'Path routing to a second origin is set up with Medianova support.', 'conditional')
  },
  {
    id: 'cdnetworks', name: 'CDNetworks / Wangsu', kind: 'cdn',
    test: (h) => prefix(h, 'x-px') || m(h.server, /wangsu|cdnetworks/i) || prefix(h, 'x-ws-'),
    cnames: [/\.(cdngc|cdnga|panthercdn|cdnetworks)\.(net|com)$/i, /\.(wscdns|wsglb0|chinanetcenter|wscloudcdn)\.com$/i],
    route: edge('CDNetworks', 'Medium', 'Path routing to a second origin is configured in the CDNetworks portal or with their support.', 'conditional')
  },
  {
    id: 'tencent', name: 'Tencent Cloud (EdgeOne / CDN)', kind: 'cdn',
    test: (h) => m(h.server, /tencent|edgeone/i) || has(h, 'eo-log-uuid', 'eo-cache-status', 'x-nws-log-uuid'),
    cnames: [/\.eo\.dnse\d\.com$/i, /\.cdn\.dnsv1\.com$/i, /\.tencent-cloud\.net$/i],
    route: edge('Tencent EdgeOne', 'Medium', 'Add an origin group for Google and a rule for the measurement path.')
  },
  {
    id: 'alibaba', name: 'Alibaba Cloud CDN', kind: 'cdn',
    test: (h) => has(h, 'eagleid', 'x-swift-cachetime', 'x-swift-savetime') || m(h.server, /^tengine/i) && has(h, 'ali-swift-global-savetime'),
    cnames: [/\.(kunlun\w*|alikunlun|aliyuncs|alicdn)\.(com|net)$/i],
    route: edge('Alibaba Cloud CDN', 'Medium', 'Use an origin rule for the measurement path, or move the path rule to your web server.', 'conditional')
  },
  {
    id: 'huawei', name: 'Huawei Cloud CDN', kind: 'cdn',
    test: (h) => m(h.server, /huaweicloud|cdnhwc/i),
    cnames: [/\.cdnhwc\d*\.(com|cn)$/i],
    route: edge('Huawei Cloud CDN', 'Medium', 'Use an origin rule for the measurement path, or move the path rule to your web server.', 'conditional')
  },
  {
    id: 'edgio', name: 'Edgio / Edgecast (discontinued)', kind: 'cdn',
    test: (h) => m(h.server, /^ECS \(|^ECAcc|^ECD \(/) || prefix(h, 'x-edg-') || has(h, 'x-ec-custom-error'),
    cnames: [/\.(edgecastcdn|systemcdn|transactcdn|edgio)\.net$/i, /\.llnwd\.net$/i, /\.llnw\.net$/i],
    route: edge('Edgio (discontinued)', 'High', 'Edgio has shut down, so this domain needs to move to a supported CDN. Set up the gateway on the new CDN.', 'conditional')
  },
  {
    id: 'stackpath', name: 'StackPath / Highwinds (discontinued)', kind: 'cdn',
    test: (h) => has(h, 'x-hw') || prefix(h, 'x-sp-'),
    cnames: [/\.(stackpathdns|stackpathcdn|hwcdn)\.(com|net)$/i],
    route: edge('StackPath (discontinued)', 'High', 'The StackPath CDN has been discontinued, so this domain needs to move to a supported CDN first.', 'conditional')
  },
  {
    id: 'quic_cloud', name: 'QUIC.cloud', kind: 'cdn',
    test: (h) => has(h, 'x-qc-cache', 'x-qc-pop'),
    cnames: [/\.quic\.cloud$/i],
    route: edge('QUIC.cloud', 'Medium', 'QUIC.cloud serves one origin, so the path rule usually goes on your LiteSpeed server.', 'conditional')
  },
  {
    id: 'section', name: 'Section', kind: 'cdn',
    test: (h) => has(h, 'section-io-id'),
    cnames: [/\.section\.io$/i],
    route: edge('Section', 'Medium', 'Add a proxy module rule for the measurement path in your Section configuration.')
  },
  {
    id: 'hostinger_cdn', name: 'Hostinger CDN', kind: 'cdn',
    test: (h) => m(h.server, /^hcdn/i) || has(h, 'x-hcdn-request-id', 'x-hcdn-cache-status'),
    cnames: [/\.hstgr\.(net|cloud)$/i, /\.cdn\.hstgr\.net$/i],
    route: edge('Hostinger', 'Medium', 'Hostinger controls the CDN. The path rule can go in .htaccess on the server if proxying is allowed on your plan.', 'conditional')
  },

  // ---------- Managed hosts that own the edge ----------
  // GitHub Pages and Firebase Hosting also sit here (further down): both run on Fastly,
  // which their users cannot configure, so their own route must win over Fastly's.
  {
    id: 'kinsta', name: 'Kinsta', kind: 'managed',
    test: (h) => has(h, 'x-kinsta-cache', 'ki-cache-type', 'ki-cf-cache-status', 'ki-edge'),
    cnames: [/\.kinsta\.cloud$/i, /\.kinstacdn\.com$/i],
    route: edge('Kinsta (managed Cloudflare)', 'Medium', 'Kinsta runs Cloudflare for you, so the path rule is added through Kinsta support.', 'conditional')
  },
  {
    id: 'wpengine', name: 'WP Engine', kind: 'managed',
    test: (h) => m(h['x-powered-by'], /wp engine/i) || has(h, 'wpe-backend', 'x-wpe-request-id'),
    cnames: [/\.wpengine\.com$/i, /\.wpeproxy\.com$/i, /\.wpenginepowered\.com$/i],
    route: edge('WP Engine', 'Medium', 'WP Engine controls the edge, so the path rule is added through WP Engine support or their Advanced Network settings.', 'conditional')
  },
  {
    id: 'pantheon', name: 'Pantheon', kind: 'managed',
    test: (h) => prefix(h, 'x-pantheon-') || has(h, 'x-styx-req-id'),
    cnames: [/\.pantheonsite\.io$/i, /\.pantheon\.io$/i],
    route: edge('Pantheon (managed Fastly)', 'Medium', 'Pantheon runs Fastly for you. Custom routing needs Pantheon Advanced Global CDN or a CDN in front.', 'conditional')
  },
  {
    id: 'acquia', name: 'Acquia', kind: 'managed',
    test: (h) => prefix(h, 'x-ah-') || has(h, 'x-acquia-path', 'x-acquia-host'),
    cnames: [/\.acquia-sites\.com$/i, /\.acquia\.com$/i],
    route: edge('Acquia', 'Medium', 'Acquia controls the edge. Add the path rule on Acquia Edge or a CDN in front of Acquia.', 'conditional')
  },
  {
    id: 'wpvip', name: 'WordPress VIP', kind: 'managed',
    test: (h) => has(h, 'x-ac', 'x-rq') && m(h['x-powered-by'], /wordpress vip|wpvip/i),
    cnames: [/\.wpvip\.com$/i, /\.go-vip\.(co|net)$/i],
    route: edge('WordPress VIP', 'Medium', 'WordPress VIP controls the edge, so the path rule is set up with VIP support.', 'conditional')
  },
  {
    id: 'cloudways', name: 'Cloudways', kind: 'managed',
    test: (h) => has(h, 'x-cloudways-cache') || m(h['x-powered-by'], /cloudways/i),
    cnames: [/\.cloudwaysapps\.com$/i],
    route: edge('Cloudways', 'Medium', 'Add the path rule in .htaccess or Nginx config through Cloudways, or on Cloudflare if you use their Cloudflare add-on.', 'conditional')
  },

  // ---------- Load balancers / gateways ----------
  {
    id: 'aws_elb', name: 'AWS Elastic Load Balancer', kind: 'lb',
    test: (h, c) => m(h.server, /^awselb/i) || m(c, /AWSALB|AWSELB/),
    cnames: [/\.elb\.amazonaws\.com$/i],
    route: edge('AWS Application Load Balancer', 'Medium', 'An AWS load balancer cannot forward to Google directly. Put CloudFront in front of it, or add the rule on your web servers.', 'conditional')
  },
  {
    id: 'azure_appgw', name: 'Azure Application Gateway', kind: 'lb',
    test: (h) => m(h.server, /microsoft-azure-application-gateway/i),
    cnames: [/\.cloudapp\.azure\.com$/i],
    route: edge('Azure Application Gateway', 'Medium', 'Add a backend pool for Google with a host name override, and a path-based rule for the measurement path.')
  },
  {
    id: 'f5_bigip', name: 'F5 BIG-IP', kind: 'lb',
    test: (h, c) => m(h.server, /big-?ip/i) || m(c, /BIGipServer/),
    cnames: [],
    route: edge('F5 BIG-IP', 'Medium', 'Add a pool for Google and an iRule or local traffic policy for the measurement path.')
  },
  {
    id: 'citrix_adc', name: 'Citrix ADC / NetScaler', kind: 'lb',
    test: (h, c) => m(c, /NSC_|citrix_ns_id/i) || has(h, 'via-netscaler') || m(h.via, /ns-cache/i),
    cnames: [],
    route: edge('NetScaler', 'Medium', 'Add a service for Google and a content switching policy for the measurement path.')
  },

  // ---------- App hosting platforms ----------
  {
    id: 'vercel', name: 'Vercel', kind: 'paas',
    test: (h) => has(h, 'x-vercel-id', 'x-vercel-cache') || m(h.server, /^vercel/i),
    cnames: [/vercel-dns\.com$/i, /\.vercel\.app$/i],
    route: edge('Vercel', 'Low', 'Handled with a rewrite rule in your Vercel or Next.js config.')
  },
  {
    id: 'netlify', name: 'Netlify', kind: 'paas',
    test: (h) => has(h, 'x-nf-request-id') || m(h.server, /^netlify/i),
    cnames: [/\.netlify\.(app|com)$/i],
    route: edge('Netlify', 'Low', 'Handled with a proxy redirect for the measurement path. Check that the Host header reaches Google correctly.', 'conditional')
  },
  {
    id: 'aws_amplify', name: 'AWS Amplify Hosting', kind: 'paas',
    test: () => false,
    cnames: [/\.amplifyapp\.com$/i],
    route: edge('AWS Amplify', 'Medium', 'Amplify rewrites can proxy a path, but custom headers are limited. A CloudFront distribution in front is the reliable route.', 'conditional')
  },
  {
    id: 'firebase', name: 'Firebase Hosting', kind: 'managed',
    test: (h) => m(h['x-served-by'], /firebase/i),
    cnames: [/\.web\.app$/i, /\.firebaseapp\.com$/i],
    route: edge('Firebase Hosting', 'Medium', 'Firebase can only rewrite to Cloud Run or Functions. Add a small proxy there, or put a load balancer in front.', 'conditional')
  },
  {
    id: 'google_frontend', name: 'Google Cloud Run / App Engine', kind: 'paas',
    test: (h) => m(h.server, /^google frontend$/i) && !m(h.via, /\b1\.1 google\b/i),
    cnames: [/\.(run|appspot)\.app$/i, /\.appspot\.com$/i],
    route: edge('Google Cloud Run / App Engine', 'Medium', 'Put a Google Cloud load balancer in front of the service, then add the path rule there.', 'conditional')
  },
  {
    id: 'heroku', name: 'Heroku', kind: 'paas',
    test: (h) => m(h.via, /vegur|heroku-router/i) || m(h.server, /heroku/i),
    cnames: [/\.herokudns\.com$/i, /\.herokuapp\.com$/i],
    route: edge('Heroku', 'Medium', 'Heroku has no proxy rules, so add the path proxy in your app or put a CDN in front.', 'conditional')
  },
  {
    id: 'render', name: 'Render', kind: 'paas',
    test: (h) => has(h, 'rndr-id', 'x-render-origin-server'),
    cnames: [/\.onrender\.com$/i],
    route: edge('Render', 'Medium', 'Render rewrites work for static sites. For services, add the proxy in your app or put a CDN in front.', 'conditional')
  },
  {
    id: 'fly', name: 'Fly.io', kind: 'paas',
    test: (h) => has(h, 'fly-request-id') || m(h.server, /^fly\//i),
    cnames: [/\.fly\.dev$/i],
    route: edge('Fly.io', 'Medium', 'Add the path proxy in your app, or in an Nginx or Caddy process on Fly.', 'conditional')
  },
  {
    id: 'digitalocean_app', name: 'DigitalOcean App Platform', kind: 'paas',
    test: (h) => has(h, 'x-do-app-origin', 'x-do-orig-status'),
    cnames: [/\.ondigitalocean\.app$/i],
    route: edge('DigitalOcean App Platform', 'Medium', 'App Platform has no external proxy rules. Add the proxy in your app, or put Cloudflare in front.', 'conditional')
  },
  {
    id: 'azure_app_service', name: 'Azure App Service', kind: 'paas',
    test: (h, c) => m(c, /ARRAffinity/) || has(h, 'x-ms-request-id') && m(h['x-powered-by'], /asp\.net/i),
    cnames: [/\.azurewebsites\.net$/i, /\.azurestaticapps\.net$/i],
    route: edge('Azure App Service', 'Medium', 'Add the proxy with IIS URL Rewrite in web.config, or put Azure Front Door in front.', 'conditional')
  },
  {
    id: 'github_pages', name: 'GitHub Pages', kind: 'managed',
    test: (h) => has(h, 'x-github-request-id') && m(h.server, /github/i),
    cnames: [/\.github\.io$/i],
    route: edge('GitHub Pages', 'Medium', 'GitHub Pages cannot proxy paths. Put a CDN such as Cloudflare in front to add the gateway.', 'limited')
  },
  {
    id: 'aws_s3', name: 'Amazon S3 website', kind: 'paas',
    test: (h) => m(h.server, /^amazons3$/i),
    cnames: [/\.s3-website[.-][\w-]+\.amazonaws\.com$/i, /\.s3\.amazonaws\.com$/i],
    route: edge('Amazon S3', 'Medium', 'S3 cannot proxy paths. Serve the site through CloudFront and add the gateway there.', 'limited')
  },

  // ---------- Web server software (origin) ----------
  {
    id: 'varnish', name: 'Varnish', kind: 'origin',
    test: (h) => has(h, 'x-varnish') || m(h.via, /varnish/i),
    cnames: [],
    route: edge('Varnish', 'Medium', 'Varnish cannot call HTTPS backends on its own. Add the path rule on the web server or TLS proxy next to it.', 'conditional')
  },
  { id: 'nginx', name: 'Nginx', kind: 'origin', test: (h) => m(h.server, /^nginx/i), cnames: [],
    route: edge('Nginx web server', 'Medium', 'No CDN sits in front of your main domain, so the proxy rule goes in your Nginx config.') },
  { id: 'openresty', name: 'OpenResty (Nginx)', kind: 'origin', test: (h) => m(h.server, /openresty/i), cnames: [],
    route: edge('OpenResty / Nginx', 'Medium', 'The proxy rule goes in your Nginx config, the same way as plain Nginx.') },
  { id: 'tengine', name: 'Tengine (Nginx)', kind: 'origin', test: (h) => m(h.server, /^tengine/i), cnames: [],
    route: edge('Tengine / Nginx', 'Medium', 'The proxy rule goes in your Nginx config, the same way as plain Nginx.') },
  { id: 'apache', name: 'Apache', kind: 'origin', test: (h) => m(h.server, /apache(?!-coyote)/i), cnames: [],
    route: edge('Apache web server', 'Medium', 'No CDN sits in front of your main domain, so the proxy rule goes in your Apache config with mod_proxy.') },
  { id: 'iis', name: 'Microsoft IIS', kind: 'origin', test: (h) => m(h.server, /microsoft-iis/i), cnames: [],
    route: edge('Microsoft IIS', 'Medium', 'The proxy rule goes in web.config with URL Rewrite and Application Request Routing.') },
  { id: 'litespeed', name: 'LiteSpeed', kind: 'origin', test: (h) => m(h.server, /litespeed/i), cnames: [],
    route: edge('LiteSpeed web server', 'Medium', 'LiteSpeed proxies through an external app definition. Shared hosting plans often do not allow it.', 'conditional') },
  { id: 'caddy', name: 'Caddy', kind: 'origin', test: (h) => m(h.server, /^caddy/i), cnames: [],
    route: edge('Caddy', 'Low', 'Add a reverse_proxy block for the measurement path in your Caddyfile.') },
  { id: 'envoy', name: 'Envoy', kind: 'origin', test: (h) => m(h.server, /envoy/i) || has(h, 'x-envoy-upstream-service-time'), cnames: [],
    route: edge('Envoy', 'Medium', 'Add a cluster for Google and a route for the measurement path.') },
  { id: 'haproxy', name: 'HAProxy', kind: 'origin', test: (h) => m(h.server, /haproxy/i), cnames: [],
    route: edge('HAProxy', 'Medium', 'Add a backend for Google and an ACL that routes the measurement path to it.') },
  { id: 'traefik', name: 'Traefik', kind: 'origin', test: (h) => m(h.server, /traefik/i), cnames: [],
    route: edge('Traefik', 'Medium', 'Add a router and external service for the measurement path.') },
  { id: 'tomcat', name: 'Apache Tomcat / Java server', kind: 'origin', test: (h) => m(h.server, /apache-coyote|jetty|wildfly|jboss|weblogic/i), cnames: [],
    route: edge('Java application server', 'Medium', 'Add the proxy on the web server or load balancer in front of the app server.', 'conditional') },
  { id: 'node', name: 'Node.js (Express)', kind: 'origin', test: (h) => m(h['x-powered-by'], /express|next\.js|nuxt/i) && !h.server, cnames: [],
    route: edge('Node.js app', 'Medium', 'Add a small proxy route for the measurement path in your app, or put a CDN in front.', 'conditional') },
  { id: 'kestrel', name: 'Kestrel (.NET)', kind: 'origin', test: (h) => m(h.server, /^kestrel/i), cnames: [],
    route: edge('Kestrel (.NET)', 'Medium', 'Add a YARP proxy route for the measurement path, or add it on IIS or Nginx in front.', 'conditional') },
  { id: 'gunicorn', name: 'Gunicorn / Python', kind: 'origin', test: (h) => m(h.server, /gunicorn|uvicorn|werkzeug/i), cnames: [],
    route: edge('Python app server', 'Medium', 'Add the proxy on the web server in front of the app, usually Nginx.', 'conditional') }
];

// Names grouped by kind, for the public "platforms we recognise" list.
export function providerCatalog() {
  const out = {};
  for (const p of PROVIDERS) (out[p.kind] ||= []).push(p.name);
  return out;
}
