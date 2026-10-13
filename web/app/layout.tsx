import type { Metadata, Viewport } from 'next';
// Font tự host: Inter (giao diện) + JetBrains Mono (số, id, JSON).
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './globals.css';
import { THEME_BOOT_SCRIPT } from '@/hooks/use-theme';

export const metadata: Metadata = {
  title: { default: 'Arb Ops', template: 'Arb Ops · %s' },
  description: 'Arb Ops — bảng điều khiển vận hành hệ thống odds arbitrage',
  applicationName: 'Arb Ops',
  appleWebApp: { capable: true, title: 'Arb Ops', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#0e1116',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
