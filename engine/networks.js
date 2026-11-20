// Which network owns a site's IP address (its ASN), and what that tells us.
// The scanner looks this up through public DNS (Team Cymru's IP-to-ASN service), so it works even where
// response headers are rewritten (the Cloudflare Worker sees "server: cloudflare" on every site).
//
// Network names below were checked against live lookups (20 Nov 2026), for example:
//   gcore.com -> AS199524 "GCORE - G-Core Labs S.A., LU"
//   qrator.net -> AS209671 "QRATOR-SW - Qrator Labs CZ s.r.o., CZ"
//   fastly.com -> AS54113 "FASTLY - Fastly, Inc., US"

// Networks that ARE a CDN / security proxy / platform edge: the site's traffic goes through that provider.
export const EDGE_NETWORKS = [
  { re: /^CLOUDFLARENET\b/i, provider: 'cloudflare' },
  { re: /^FASTLY\b/i, provider: 'fastly' },
  { re: /^AKAMAI-(AS|ASN1)\b/i, provider: 'akamai' },          // not AKAMAI-LINODE (cloud servers)
  { re: /^GCORE\b/i, provider: 'gcore' },
  { re: /^QRATOR/i, provider: 'qrator' },
  { re: /^SUCURI/i, provider: 'sucuri' },
  { re: /^INCAPSULA\b/i, provider: 'imperva' },
  { re: /^(BunnyCDN|BUNNYWAY)\b/i, provider: 'bunny' },
  { re: /^CACHENETWORKS\b/i, provider: 'cachefly' },
  { re: /^Medianova\b/i, provider: 'medianova' },
  { re: /^PROINITY\b/i, provider: 'keycdn' },
  { re: /^DDOS-GUARD\b/i, provider: 'ddos_guard' },
  { re: /^LINK11\b/i, provider: 'link11' },
  { re: /^FLY\b/i, provider: 'fly' },
  { re: /^RENDER\b/i, provider: 'render' }
];

// Networks that only HOST the server: useful to show, but they say nothing about a CDN in front.
export const HOSTING_NETWORKS = [
  { re: /^AMAZON/i, label: 'Amazon Web Services' },
  { re: /^GOOGLE/i, label: 'Google Cloud' },
  { re: /^MICROSOFT/i, label: 'Microsoft Azure' },
  { re: /^DIGITALOCEAN/i, label: 'DigitalOcean' },
  { re: /^AS-VULTR|VULTR/i, label: 'Vultr' },
  { re: /^HETZNER/i, label: 'Hetzner' },
  { re: /^OVH/i, label: 'OVHcloud' },
  { re: /LINODE/i, label: 'Akamai Cloud (Linode)' },
  { re: /^ORACLE/i, label: 'Oracle Cloud' },
  { re: /^ALIBABA/i, label: 'Alibaba Cloud' },
  { re: /^AUTOMATTIC/i, label: 'Automattic (WordPress.com / VIP)' },
  { re: /^wix_com/i, label: 'Wix' },
  { re: /^SQUARESPACE/i, label: 'Squarespace' },
  { re: /^HOSTINGER/i, label: 'Hostinger' },
  { re: /^IONOS|^1AND1/i, label: 'IONOS' },
  { re: /^GODADDY/i, label: 'GoDaddy' },
  { re: /^UNIFIEDLAYER|BLUEHOST/i, label: 'Newfold Digital (Bluehost)' },
  { re: /^SINGLEHOP|^LIQUIDWEB/i, label: 'Liquid Web' }
];

// "GCORE - G-Core Labs S.A., LU" -> "G-Core Labs S.A."
export function orgName(raw) {
  const s = String(raw || '').trim();
  const afterDash = s.includes(' - ') ? s.slice(s.indexOf(' - ') + 3) : s;
  return afterDash.replace(/,\s*[A-Z]{2}$/, '').trim() || s;
}

// network = { asn: '199524', name: 'GCORE - G-Core Labs S.A., LU' }
export function classifyNetwork(network) {
  if (!network || !network.asn || !network.name) return null;
  const edge = EDGE_NETWORKS.find((r) => r.re.test(network.name));
  const hosting = edge ? null : HOSTING_NETWORKS.find((r) => r.re.test(network.name));
  const org = orgName(network.name);
  return {
    asn: String(network.asn),
    org,
    providerId: edge ? edge.provider : null,
    label: hosting ? hosting.label : org
  };
}
