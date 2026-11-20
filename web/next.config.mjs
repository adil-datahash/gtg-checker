// Static export for GitHub Pages. A project site lives at https://<owner>.github.io/<repo>/,
// so the build sets NEXT_PUBLIC_BASE_PATH=/<repo>. Leave it empty for a user site or a custom domain.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath,
  assetPrefix: basePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true
};
export default nextConfig;
