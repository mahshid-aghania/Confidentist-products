/** @type {import('next').NextConfig} */
const nextConfig = {
  // Existing marketing site uses trailing-slash URLs (matches the canonical tags).
  trailingSlash: true,

  async rewrites() {
    return {
      // Serve the existing static homepage at "/"
      beforeFiles: [{ source: '/', destination: '/index.html' }],
      // For any clean marketing URL with no Next route and no exact file,
      // fall back to the matching static index.html in /public.
      // e.g. /afk-programs/ -> /afk-programs/index.html
      fallback: [{ source: '/:path*', destination: '/:path*/index.html' }],
    }
  },
}

module.exports = nextConfig
