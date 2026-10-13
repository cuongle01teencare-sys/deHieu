import type { MetadataRoute } from 'next';

/** PWA: cài lên màn hình chính (bắt buộc cho push trên iOS 16.4+). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Arb Ops — Control Room',
    short_name: 'Arb Ops',
    description: 'Bảng điều khiển vận hành hệ thống odds arbitrage',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0e1116',
    theme_color: '#0e1116',
    lang: 'vi',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    shortcuts: [
      { name: 'Sự cố', url: '/su-co', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Kèo', url: '/keo', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
