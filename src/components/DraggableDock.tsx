'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Rnd } from 'react-rnd';
import Image from 'next/image';

/** Accepts any object that at least has name & icon; extra fields are fine. */
export type DockApp = { name: string; icon: string } & Record<string, unknown>;

export type DraggableDockProps<T extends DockApp = DockApp> = {
  apps: T[];
  onAppClick: (a: T) => void;
  /** Names of apps that are active (show the dot) */
  activeNames?: Set<string>;
  /** Names of apps that are minimized (faded dot) */
  minimizedNames?: Set<string>;
  /** Optional initial rectangle; persisted after first move/resize */
  initial?: { x?: number; y?: number; width?: number; height?: number };
  zIndex?: number;
};

type DockState = { x: number; y: number; w: number; h: number };

const LS_KEY = 'dock_state_v1';

export default function DraggableDock<T extends DockApp = DockApp>({
  apps,
  onAppClick,
  activeNames,
  minimizedNames,
  initial,
  zIndex = 240,
}: DraggableDockProps<T>) {
  const [mounted, setMounted] = useState(false);

  // sensible defaults (avoid touching window during SSR)
  const [dock, setDock] = useState<DockState>(() => ({
    x: initial?.x ?? 48,
    y: initial?.y ?? 0, // set after mount to bottom
    w: initial?.width ?? 480,
    h: initial?.height ?? 76,
  }));

  // mount: restore from localStorage + push dock to bottom
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<DockState>;
        setDock((d) => ({
          x: Number.isFinite(parsed.x) ? (parsed.x as number) : d.x,
          y: Number.isFinite(parsed.y) ? (parsed.y as number) : d.y,
          w: Number.isFinite(parsed.w) ? (parsed.w as number) : d.w,
          h: Number.isFinite(parsed.h) ? (parsed.h as number) : d.h,
        }));
      } else {
        // first run: stick near bottom center
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        setDock((d) => ({
          x: Math.max(12, Math.round((vw - d.w) / 2)),
          y: Math.max(12, vh - d.h - 20),
          w: d.w,
          h: d.h,
        }));
      }
    } catch {}
    setMounted(true);
  }, []);

  const persist = (ns: DockState) => {
    setDock(ns);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(ns));
    } catch {}
  };

  // Make icon size follow dock height.
  const iconPx = useMemo(() => {
    const inner = Math.max(56, Math.min(120, dock.h - 16)); // padding → inner height
    return inner; // px
  }, [dock.h]);

  if (!mounted) return null;

  return (
    <Rnd
      bounds="window"
      position={{ x: dock.x, y: dock.y }}
      size={{ width: dock.w, height: dock.h }}
      minWidth={240}
      minHeight={64}
      maxHeight={140}
      enableResizing={{
        left: true,
        right: true,
        top: true,
        bottom: true,
        topLeft: true,
        topRight: true,
        bottomLeft: true,
        bottomRight: true,
      }}
      disableDragging={false}
      // Drag anywhere except on icons (so clicks don't start a drag)
      cancel=".dock-icon"
      onDragStop={(_e, data) => {
        persist({ x: data.x, y: data.y, w: dock.w, h: dock.h });
      }}
      onResizeStop={(_e, _dir, ref, _delta, pos) => {
        persist({ x: pos.x, y: pos.y, w: ref.offsetWidth, h: ref.offsetHeight });
      }}
      style={{
        zIndex,
        position: 'fixed',
        borderRadius: 20,
        background: 'rgba(0,0,0,0.30)',
        backdropFilter: 'blur(18px) saturate(140%)',
        WebkitBackdropFilter: 'blur(18px) saturate(140%)',
        border: '1px solid rgba(255,255,255,0.18)',
        boxShadow: '0 8px 28px rgba(2,6,23,0.28)',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <div className="flex w-full items-center justify-center gap-3 px-4">
        {apps.map((app) => (
          <DockIcon
            key={app.name}
            app={app}
            size={iconPx}
            active={!!activeNames?.has(app.name)}
            minimized={!!minimizedNames?.has(app.name)}
            onAppClick={onAppClick}
          />
        ))}
      </div>
    </Rnd>
  );
}

/* ----------------- Icon ----------------- */

function DockIcon<T extends DockApp>({
  app,
  active,
  minimized,
  onAppClick,
  size,
}: {
  app: T;
  active?: boolean;
  minimized?: boolean;
  onAppClick: (a: T) => void;
  size: number; // pixels
}) {
  const [showTip, setShowTip] = useState(false);
  return (
    <button
      onClick={() => onAppClick(app)}
      onTouchStart={() => {
        setShowTip(true);
        window.setTimeout(() => setShowTip(false), 1100);
      }}
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
      onFocus={() => setShowTip(true)}
      onBlur={() => setShowTip(false)}
      aria-label={app.name}
      className="dock-icon relative select-none focus:outline-none transition-transform duration-150 hover:scale-[1.10] active:scale-95"
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      {/* Tooltip */}
      <span
        className={`pointer-events-none z-50 absolute -top-7 left-1/2 -translate-x-1/2 rounded px-2 py-0.5 text-[10px] font-medium text-white bg-black/80 shadow transition-all duration-150 ${
          showTip ? 'opacity-100 -translate-y-1' : 'opacity-0'
        }`}
      >
        {app.name}
      </span>

      {/* Icon container sized from dock height */}
      <span className="relative block" style={{ width: size, height: size }}>
        <Image src={app.icon} alt={app.name} fill className="object-contain" sizes={`${Math.ceil(size)}px`} />
      </span>

      {/* Activity dot (same list as your original) */}
      {['Settings', 'Inventory Management', 'Add medicine', 'Sell medicine', 'Reports and Analytics'].includes(
        app.name
      ) && (
        <span
          className={`absolute -bottom-1 left-1/2 -translate-x-1/2 h-1 w-1.5 rounded-full ${
            active ? 'bg-white/90' : minimized ? 'bg-white/40' : 'bg-transparent'
          }`}
        />
      )}
    </button>
  );
}
