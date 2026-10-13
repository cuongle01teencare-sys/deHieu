import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  // không tự sinh AGENTS.md khi chạy dev
  agentRules: false,
  // iron-session dùng node:crypto ở server; không bundle vào client
  serverExternalPackages: ['iron-session'],
  outputFileTracingIncludes: {
    '/tai-lieu': ['./content/system-guide.md'],
    '/api/system-guide': ['./content/system-guide.md'],
  },
};

export default nextConfig;
