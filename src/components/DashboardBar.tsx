'use client';

import Image from 'next/image';
import { Bell } from 'lucide-react';

type DashboardBarProps = {
  /** Path to your logo in /public */
  logoSrc?: string;
  /** Show title next to logo (off by default) */
  showTitle?: boolean;
  /** Optional title text if you ever enable it */
  title?: string;
  /** Number to show on the bell badge */
  notifCount?: number;
  /** Click handler for opening your notifications panel */
  onBellClick?: () => void;
  /** z-index of the bar */
  zIndex?: number;
  /** Extra classes */
  className?: string;
};

export default function DashboardBar({
  logoSrc = '/logob.png',
  showTitle = false,
  title = 'Dashboard',
  notifCount = 0,
  onBellClick,
  zIndex = 50,
  className = '',
}: DashboardBarProps) {
  return (
    <div
      className={`fixed inset-x-0 top-0 ${className}`}
      style={{ zIndex, paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div
        className="
          h-16 md:h-16 px-4 md:px-6
          flex items-center justify-between
          bg-white/55 backdrop-blur-xl border-b border-white/60
          shadow-[0_8px_28px_rgba(2,6,23,0.08)]
        "
      >
        {/* Left: BIG logo, no square wrapper */}
        <div className="flex items-center gap-3 select-none">
          <Image
            src={logoSrc}
            alt="Logob"
            width={180}     /* intrinsic size for layout */
            height={56}
            className="h-12 md:h-14 w-auto object-contain"
            priority
          />
          {showTitle && (
            <span className="text-sm md:text-base font-semibold text-slate-800">
              {title}
            </span>
          )}
        </div>

        {/* Right: Bell */}
        <button
          onClick={onBellClick}
          className="
            relative h-10 min-w-10 px-3 rounded-xl
            border border-white/40 bg-white/60 hover:bg-white/80
            backdrop-blur shadow transition
          "
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5 text-slate-700" />
          {notifCount > 0 && (
            <span
              className="
                absolute -top-2 -right-2
                text-[10px] rounded-full px-1.5 py-[2px]
                bg-rose-500 text-white shadow
              "
            >
              {Math.min(99, notifCount)}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
