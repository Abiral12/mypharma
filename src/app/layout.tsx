import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import LogoCorner from '@/components/DashboardBar';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Pharmacy',
  description: 'Glassy dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} min-h-dvh text-slate-900`}>
        {/* Only the logo in the top-left, bigger */}
        <LogoCorner />
        {children}
      </body>
    </html>
  );
}
