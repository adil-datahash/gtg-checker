import Checker from '@/components/Checker.jsx';
import InfoSections from '@/components/InfoSections.jsx';

const PRIVACY = process.env.NEXT_PUBLIC_PRIVACY_URL || 'https://datahash.com/privacy-policy';

// Structured data so search engines understand this is a free web tool.
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'Google tag gateway checker',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Any',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  provider: { '@type': 'Organization', name: 'Datahash', url: 'https://datahash.com' }
};

export default function Home() {
  return (
    <div className="page">
      <header className="site-header">
        <a className="brand" href="https://datahash.com">Datahash</a>
        <nav aria-label="Page">
          <a href="#checks-title">What we check</a>
          <a href="#platforms-title">Platforms</a>
          <a href="#faq-title">Questions</a>
        </nav>
      </header>
      <main>
        <Checker />
        <InfoSections />
      </main>
      <footer className="site-footer">
        <p>Built by Datahash. We help brands send complete, consented conversion data to the ad platforms they use.</p>
        <a href={PRIVACY} target="_blank" rel="noopener noreferrer">Privacy policy</a>
      </footer>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </div>
  );
}
