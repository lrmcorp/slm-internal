/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" }
];

const nextConfig = {
  poweredByHeader: false,
  typedRoutes: false,
  experimental: {
    cpus: 1,
  },
  // Favicon per instance: /favicon.ico dan /icon.svg dilayani route brand-icon (logo instance bila ada),
  // sebelum file statis bersama di public/.
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/favicon.ico", destination: "/brand-icon.svg" },
        { source: "/icon.svg", destination: "/brand-icon.svg" }
      ]
    };
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // nginx menahan seluruh jawaban sebelum diteruskan; tanpa ini kerangka muat (loading.tsx) baru tiba bersama isi halaman.
      { source: "/:path*", headers: [{ key: "X-Accel-Buffering", value: "no" }] },
    ];
  }
};

export default nextConfig;
