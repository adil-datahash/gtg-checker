// Lead capture: validation, A/B/C grading, and the payload for the shared Zoho Flow webhook.
import { registrableDomain } from './detect.js';

const FREE_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.in', 'yahoo.co.in', 'yahoo.co.uk', 'hotmail.com', 'outlook.com',
  'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'zoho.com', 'zohomail.com',
  'zohomail.in', 'yandex.com', 'mail.com', 'gmx.com', 'rediffmail.com', 'hey.com', 'tutanota.com', 'fastmail.com'
]);
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com',
  'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com'
]);

export class LeadError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const clean = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

export function validateLead(body) {
  const email = clean(body.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new LeadError('invalid_email', 'Enter a valid email address.');
  const name = clean(body.name, 120);
  if (!name) throw new LeadError('invalid_name', 'Enter your name.');
  if (body.consent !== true) throw new LeadError('no_consent', 'Tick the consent box to get your report.');
  const phone = clean(body.phone, 30);
  if (phone && !/^[+\d][\d\s().-]{6,}$/.test(phone)) throw new LeadError('invalid_phone', 'Enter the phone number with its country code, or leave it empty.');
  const roles = ['Marketing', 'Developer / IT', 'Agency', 'Founder / Leadership', 'Other'];
  const role = roles.includes(body.role) ? body.role : '';
  const utm = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    if (body.utm && body.utm[k]) utm[k] = clean(body.utm[k], 100);
  }
  return { email, name, company: clean(body.company, 120), phone, role, utm, consent: true };
}

export function gradeLead(lead, report) {
  const emailDomain = lead.email.split('@')[1];
  const reasons = [];
  if (DISPOSABLE_DOMAINS.has(emailDomain)) return { grade: 'C', emailType: 'disposable', reasons: ['Disposable email domain'] };
  if (FREE_DOMAINS.has(emailDomain)) return { grade: 'C', emailType: 'free', reasons: ['Free email domain'] };

  const ownsSite = registrableDomain(emailDomain) === registrableDomain(report.host);
  // 'unconfirmed' is left out on purpose: GTG may already be live there.
  const needsGtg = ['not_implemented', 'partial', 'blocked'].includes(report.verdict.status);
  const eligible = report.route.eligible === 'yes';
  if (ownsSite) reasons.push('Email domain matches the scanned site');
  if (needsGtg) reasons.push('Site does not fully use Google tag gateway');
  if (eligible) reasons.push('Infrastructure supports a standard setup');
  if (lead.role === 'Agency') reasons.push('Agency: possible multi-client account');

  const grade = ownsSite && needsGtg && eligible ? 'A' : 'B';
  return { grade, emailType: 'business', ownsSite, reasons };
}

// Payload follows the shared lead-magnet routing contract: tool, result JSON, grade, UTM.
export function buildLeadPayload(lead, grading, report, meta) {
  return {
    tool: 'gtg_eligibility_checker',
    tool_version: '2.0.0',
    submitted_at: new Date().toISOString(),
    lead: {
      email: lead.email,
      name: lead.name,
      company: lead.company,
      phone: lead.phone,
      role: lead.role,
      consent: lead.consent,
      consent_text_version: meta.consentVersion
    },
    grade: grading.grade,
    grade_reasons: grading.reasons,
    email_type: grading.emailType,
    scanned_site: report.host,
    result: {
      status: report.verdict.status,
      confidence: report.verdict.confidence || null,
      cdn: report.infra.primary,
      proxy_type: report.infra.proxyType,
      platform: report.platform.name,
      route: report.route.key,
      gtg_served_by: report.gtg ? report.gtg.servedBy : null,
      infra_stack: (report.infra.stack || []).map((x) => x.name),
      eligible: report.route.eligible,
      gtm_ids: report.tags.gtm,
      hardcoded_ids: report.tags.hardcoded,
      warnings: report.warnings.map((w) => w.code)
    },
    utm: lead.utm,
    page: meta.page
  };
}
