import './globals.css';

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

export const metadata = {
  metadataBase: new URL(SITE),
  title: 'Google tag gateway checker | Datahash',
  description: 'Check whether a website serves its Google tags through Google tag gateway, which CDN or load balancer serves the gateway, and how to set it up.',
  alternates: { canonical: `${SITE}/` },
  openGraph: {
    title: 'Google tag gateway checker',
    description: 'Is Google tag gateway set up on your site? Which CDN runs it? Free check in about 10 seconds.',
    type: 'website',
    url: `${SITE}/`
  },
  robots: { index: true, follow: true }
};

export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
