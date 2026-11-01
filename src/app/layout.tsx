import type { Metadata, Viewport } from 'next';
import { Instrument_Serif, Manrope } from 'next/font/google';
import './globals.css';
import { PlatformConnector } from '@/components/PlatformConnector';

const display = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-display',
  display: 'swap',
});

const sans = Manrope({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Le Président — jeu de cartes en ligne',
  description:
    'Le Président en multijoueur temps réel : 3 à 8 joueurs, table premium, animations de cartes et règles officielles. Créez une salle et partagez le code.',
  applicationName: 'Le Président',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Le Président' },
  openGraph: {
    title: 'Le Président — jeu de cartes en ligne',
    description:
      'Affrontez 3 à 8 joueurs en temps réel. Dame de pique, carrés, Président et Trou du Cul.',
    type: 'website',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#04140f',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${display.variable} ${sans.variable}`}>
      <body className="min-h-dvh antialiased"><PlatformConnector />{children}</body>
    </html>
  );
}
