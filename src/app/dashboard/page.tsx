'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import {
  Wifi,
  Bell,
  Landmark,
  Package2,
  PiggyBank,
  BellRing,
  Settings as Cog,
  X,
} from 'lucide-react';

/* ========== Dynamic client-only windows ========== */
const SellMedicineWindow = dynamic(() => import('@/components/SellMedicineWindow'), { ssr: false });
const SettingsWindow     = dynamic(() => import('@/components/SettingsWindow'),     { ssr: false });
const InventoryWindow    = dynamic(() => import('@/components/InventoryWindow'),    { ssr: false });
const AddMedicineWindow  = dynamic(() => import('@/components/AddMedicineWindow'),  { ssr: false });
const ReportsWindow      = dynamic(() => import('@/components/ReportsWindow'),      { ssr: false });

/* ---------------------- Local Types ---------------------- */
type AppIcon = {
  name: string;
  icon: string;
  action?: 'openSettings' | 'openInventory' | 'openAdd' | 'openSell' | 'openReports';
};

type Pos = { x: number; y: number };
type WidgetId = 'sales' | 'inventory' | 'profit' | 'notifications';

/** Sales API */
type SaleLine = { id: string; name: string; price: number; qty: number; lineTotal: number };
type SaleItem = { _id: string; total: number; createdAt: string; createdBy?: string | null; lines: SaleLine[] };
type ApiSalesList = { items: SaleItem[]; totalCount: number; page: number; pages: number; error?: string };

/** Inventory API (subset we need) */
type ApiBatchRow = {
  id: string;                 // batchNo
  name: string;
  qty: number;                // qtyAvailable
  expiryDate: string | '';
  supplierName: string | null;
};

/** Notifications */
type Notif = {
  id: string;
  time?: string | null;
  kind: 'sale' | 'low' | 'inventory' | 'expiry';
  text: string;
};

type Summary = { revenue: number; profit: number; orders: number; items: number };

/* ---------------------- Dock icons ---------------------- */
const apps: AppIcon[] = [
  { name: 'Sell medicine', icon: '/icons/Sellicon.png', action: 'openSell' },
  { name: 'Add medicine', icon: '/icons/addicon.png', action: 'openAdd' },
  { name: 'Inventory Management', icon: '/icons/Inventory.png', action: 'openInventory' },
  { name: 'Reports and Analytics', icon: '/icons/Reports.png', action: 'openReports' },
  { name: 'Settings', icon: '/icons/settings.png', action: 'openSettings' },
];

/* ==================== Utilities ==================== */
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const money = (n: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'NPR', maximumFractionDigits: 0 }).format(n);

function useBoardSize(ref: React.MutableRefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 1024, h: 640 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    setSize({ w: el.clientWidth, h: el.clientHeight });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** tiny sparkline */
function Sparkline({ data }: { data: number[] }) {
  const width = 120;
  const height = 26;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const norm = (v: number) => (max === min ? height / 2 : height - ((v - min) / (max - min)) * height);
  const step = width / (data.length - 1);
  const d = data.map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${norm(v)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-6">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500" />
    </svg>
  );
}

/* ==================== Widgets Shell ==================== */
function CardShell({
  icon,
  title,
  subtitle,
  children,
  onClick,
}: {
  icon: React.ReactNode;
  title: string | React.ReactNode;
  subtitle?: string;
  children?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
      }}
      className="
        w-[184px] md:w-[200px]
        rounded-xl border border-white/35
        bg-white/55 md:bg-white/45
        shadow-[0_8px_28px_rgba(2,6,23,0.10)]
        backdrop-blur-xl p-3 text-left
        hover:bg-white/60 transition
        cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
      "
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg grid place-items-center bg-gradient-to-br from-white/70 to-white/30 border border-white/40 text-slate-700">
            {icon}
          </div>
          <div>
            <div className="text-[10px] text-slate-500">{subtitle}</div>
            <div className="text-[13px] font-semibold text-slate-900">{title}</div>
          </div>
        </div>
        <span
          className="hidden md:inline-flex items-center gap-1 rounded-md px-1.5 py-[2px]
                     text-[10px] text-slate-600 border border-white/40 bg-white/40"
        >
          <Cog className="w-3.5 h-3.5" />
          Settings
        </span>
      </div>
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

/* ==================== Widgets (data-driven) ==================== */
function SalesWidget({ value, onOpenReports }: { value: number; onOpenReports: () => void }) {
  return (
    <CardShell icon={<Landmark className="w-4 h-4" />} title={money(value)} subtitle="Total Sales (MTD)" onClick={onOpenReports}>
      <div className="text-[10px] text-emerald-600">▲ estimated vs last month</div>
      <div className="mt-1">
        <Sparkline data={[12, 14, 13, 16, 21, 19, 24]} />
      </div>
    </CardShell>
  );
}
function InventoryWidget({ value, onOpenReports }: { value: number; onOpenReports: () => void }) {
  return (
    <CardShell icon={<Package2 className="w-4 h-4" />} title={value.toLocaleString()} subtitle="Inventory Balance" onClick={onOpenReports}>
      <div className="text-[10px] text-slate-600">items in stock</div>
      <div className="mt-2 h-1.5 w-full rounded-full bg-white/60 overflow-hidden border border-white/40">
        <div className="h-full w-[62%] bg-blue-500/70" />
      </div>
    </CardShell>
  );
}
function ProfitWidget({ value, onOpenReports }: { value: number; onOpenReports: () => void }) {
  return (
    <CardShell icon={<PiggyBank className="w-4 h-4" />} title={money(value)} subtitle="Net Profit (MTD)" onClick={onOpenReports}>
      <div className="text-[10px] text-emerald-600">▲ estimated vs last month</div>
      <div className="mt-1">
        <Sparkline data={[6, 8, 7, 9, 10, 12, 11, 13]} />
      </div>
    </CardShell>
  );
}
function NotificationsWidget({
  items,
  onOpenAll,
  onOpenReports,
}: {
  items: Notif[];
  onOpenAll: () => void;
  onOpenReports: () => void;
}) {
  const top2 = items.slice(0, 2);
  return (
    <CardShell icon={<BellRing className="w-4 h-4" />} title="Notifications" subtitle="Latest" onClick={onOpenReports}>
      <ul className="space-y-1.5">
        {top2.length === 0 ? (
          <li className="rounded-lg border border-white/40 bg-white/55 px-2 py-1.5 text-[12px] text-slate-600">No new alerts</li>
        ) : (
          top2.map((n) => (
            <li key={n.id} className="rounded-lg border border-white/40 bg-white/55 px-2 py-1.5 text-[12px] text-slate-800">
              {n.text}
            </li>
          ))
        )}
      </ul>
      <div className="mt-2 text-[11px]">
        <button onClick={(e) => { e.stopPropagation(); onOpenAll(); }} className="underline text-slate-600 hover:text-slate-900">
          View all
        </button>
      </div>
    </CardShell>
  );
}

/* ==================== Draggable (desktop) ==================== */
function Draggable({
  id,
  containerRef,
  initial,
  disabled,
  children,
}: {
  id: WidgetId;
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  initial: Pos;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<Pos>(() => {
    try {
      const raw = localStorage.getItem(`dash_pos_${id}`);
      if (raw) return JSON.parse(raw) as Pos;
    } catch {}
    return initial;
  });

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    const wrap = containerRef.current;
    if (!wrap) return;
    const el = e.currentTarget as HTMLDivElement;
    const rect = el.getBoundingClientRect();
    const wrect = wrap.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;

    el.setPointerCapture?.(e.pointerId);

    const move = (ev: PointerEvent) => {
      const x = clamp(ev.clientX - wrect.left - dx, 0, wrect.width - rect.width);
      const y = clamp(ev.clientY - wrect.top - dy, 0, wrect.height - rect.height);
      const np = { x, y };
      setPos(np);
    };
    const up = () => {
      el.releasePointerCapture?.(e.pointerId);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try {
        localStorage.setItem(`dash_pos_${id}`, JSON.stringify(pos));
      } catch {}
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  useEffect(() => {
    try {
      localStorage.setItem(`dash_pos_${id}`, JSON.stringify(pos));
    } catch {}
  }, [id, pos]);

  return (
    <div
      onPointerDown={onPointerDown}
      className="absolute touch-none cursor-grab active:cursor-grabbing"
      style={{ left: pos.x, top: pos.y }}
    >
      {children}
    </div>
  );
}

/* ==================== Dock Icon ==================== */
function DockIcon({
  app,
  active,
  minimized,
  onClick,
}: {
  app: AppIcon;
  active?: boolean;
  minimized?: boolean;
  onClick: (a: AppIcon) => void;
}) {
  const [showTip, setShowTip] = useState(false);
  const briefReveal = () => {
    setShowTip(true);
    window.setTimeout(() => setShowTip(false), 1100);
  };
  return (
    <button
      onClick={() => onClick(app)}
      onTouchStart={briefReveal}
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
      onFocus={() => setShowTip(true)}
      onBlur={() => setShowTip(false)}
      aria-label={app.name}
      className="relative select-none focus:outline-none h-11 w-11 sm:h-12 sm:w-12 md:h-14 md:w-14 transition-transform duration-150 hover:scale-[1.12] active:scale-95"
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      <span
        className={`pointer-events-none z-50 absolute -top-7 md:-top-8 left-1/2 -translate-x-1/2
          rounded px-2 py-0.5 text-[10px] font-medium text-white bg-black/80 shadow
          transition-all duration-150 ${showTip ? 'opacity-100 -translate-y-1' : 'opacity-0'}`}
      >
        {app.name}
      </span>

      <span className="relative block h-full w-full">
        <Image src={app.icon} alt={app.name} fill className="object-contain p-1.5 sm:p-2" sizes="56px" />
      </span>

      {['Settings', 'Inventory Management', 'Add medicine', 'Sell medicine', 'Reports and Analytics'].includes(app.name) && (
        <span
          className={`absolute -bottom-1 left-1/2 -translate-x-1/2 h-1 w-1.5 rounded-full
            ${active ? 'bg-white/90' : minimized ? 'bg-white/40' : 'bg-transparent'}`}
        />
      )}
    </button>
  );
}

/* ==================== Page ==================== */
export default function DashboardPage() {
  // Settings window
  const [showSettings, setShowSettings] = useState(false);
  const [minSettings, setMinSettings] = useState(false);
  const [settingsZ, setSettingsZ] = useState(101);
  const bringSettingsToFront = useCallback(() => setSettingsZ((z) => z + 1), []);

  // Inventory window
  const [showInventory, setShowInventory] = useState(false);
  const [minInventory, setMinInventory] = useState(false);
  const [inventoryZ, setInventoryZ] = useState(120);
  const bringInventoryToFront = useCallback(() => setInventoryZ((z) => z + 1), []);

  // Add medicine window
  const [showAdd, setShowAdd] = useState(false);
  const [minAdd, setMinAdd] = useState(false);
  const [addZ, setAddZ] = useState(130);
  const bringAddToFront = useCallback(() => setAddZ((z) => z + 1), []);

  // Sell window
  const [showSell, setShowSell] = useState(false);
  const [minSell, setMinSell] = useState(false);
  const [sellZ, setSellZ] = useState(140);
  const bringSellToFront = useCallback(() => setSellZ((z) => z + 1), []);

  // Reports window
  const [showReports, setShowReports] = useState(false);
  const [minReports, setMinReports] = useState(false);
  const [reportsZ, setReportsZ] = useState(150);
  const bringReportsToFront = useCallback(() => setReportsZ((z) => z + 1), []);

  const openReports = () => { setShowReports(true); setMinReports(false); bringReportsToFront(); };

  const handleAppClick = (app: AppIcon) => {
    if (app.action === 'openSettings') {
      setShowSettings(true); setMinSettings(false); bringSettingsToFront();
    } else if (app.action === 'openInventory' || app.name === 'Inventory Management') {
      setShowInventory(true); setMinInventory(false); bringInventoryToFront();
    } else if (app.action === 'openAdd' || app.name === 'Add medicine') {
      setShowAdd(true); setMinAdd(false); bringAddToFront();
    } else if (app.action === 'openSell' || app.name === 'Sell medicine') {
      setShowSell(true); setMinSell(false); bringSellToFront();
    } else if (app.action === 'openReports') {
      openReports();
    }
  };

  // clock (optional)
  const [timeText, setTimeText] = useState('');
  useEffect(() => {
    const update = () =>
      setTimeText(new Date().toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
      }));
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, []);

  // --- Metrics populated from backend ---
  const [salesMTD, setSalesMTD] = useState(0);
  const [profitMTD, setProfitMTD] = useState(0);
  const [inventoryCount, setInventoryCount] = useState(0);
  const [notifs, setNotifs] = useState<Notif[]>([]);

  async function loadFromBackend() {
    try {
      // Sales (recent page)
      const sres = await fetch('/api/sales?page=1&limit=50', { credentials: 'include', cache: 'no-store' });
      const sdata = (await sres.json()) as ApiSalesList;
      if (sres.ok && Array.isArray(sdata.items)) {
        const now = new Date();
        const month = now.getMonth();
        const year = now.getFullYear();
        const mtd = sdata.items.filter((s) => {
          const d = new Date(s.createdAt);
          return d.getMonth() === month && d.getFullYear() === year;
        });
        const total = mtd.reduce((a, s) => a + s.total, 0);
        setSalesMTD(total);
        setProfitMTD(Math.round(total * 0.18)); // simple estimate

        const saleNotifs: Notif[] = sdata.items.slice(0, 15).map((s) => {
          const qty = s.lines.reduce((a, l) => a + l.qty, 0);
          return {
            id: `sale-${s._id}`,
            time: s.createdAt,
            kind: 'sale',
            text: `Sold ${qty} (${s.lines.length} SKUs) – ${money(s.total)}`,
          };
        });

        // Inventory (basic scan for low stock)
        const ires = await fetch('/api/inventory?take=200', { credentials: 'include', cache: 'no-store' });
        const idata = (await ires.json()) as { items?: ApiBatchRow[] };
        if (ires.ok && Array.isArray(idata.items)) {
          setInventoryCount(idata.items.reduce((a, x) => a + (x.qty || 0), 0));
          const lows: Notif[] = idata.items
            .filter((b) => (b.qty ?? 0) <= 5)
            .slice(0, 20)
            .map((b) => ({
              id: `low-${b.id}`,
              kind: 'low',
              text: `Low stock: ${b.name} (${b.qty} left)`,
            }));
          const exp: Notif[] = idata.items
            .filter((b) => b.expiryDate)
            .filter((b) => {
              const in30 = Date.now() + 30 * 24 * 60 * 60 * 1000;
              return new Date(b.expiryDate!).getTime() < in30;
            })
            .slice(0, 10)
            .map((b) => ({
              id: `exp-${b.id}`,
              kind: 'expiry',
              text: `Expiring soon: ${b.name} (${b.expiryDate})`,
            }));
          setNotifs([...lows, ...exp, ...saleNotifs]);
        } else {
          // No inventory -> still show sale notifs
          setNotifs(saleNotifs);
        }
      }
    } catch {
      // Soft fallback values
      setSalesMTD(128_750);
      setProfitMTD(18_450);
      setInventoryCount(1240);
      setNotifs([
        { id: 'm1', kind: 'low', text: 'Low stock: Amoxicillin 250mg (6 left)' },
        { id: 'm2', kind: 'expiry', text: 'Batch B-2025-09 expires in 30 days' },
      ]);
    }
  }
  useEffect(() => { loadFromBackend(); }, []);

  // desktop widget board setup
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { w: boardW } = useBoardSize(containerRef);

  // default desktop positions (neatly aligned grid, but fully draggable later)
  const defaultPos: Record<WidgetId, Pos> = useMemo(() => {
    const startX = 20;
    const startY = 88; // leave space for logo/top controls if any
    const gap = 24;
    const colW = 200; // card width
    const rowH = 160; // card height estimate

    return {
      sales:         { x: startX,               y: startY },
      profit:        { x: startX + colW + gap, y: startY },
      inventory:     { x: startX,               y: startY + rowH + gap },
      notifications: { x: startX + colW + gap, y: startY + rowH + gap },
    };
  }, [boardW]);

  // bell panel
  const [openBell, setOpenBell] = useState(false);

  return (
    <div className="relative w-full min-h-[100dvh] overflow-hidden">
      {/* Wallpaper */}
      <div className="fixed inset-0 bg-cover bg-center" style={{ backgroundImage: "url('/bg4.png')" }} />

      {/* Top-right bell (no page padding/limits) */}
      <button
        onClick={() => setOpenBell(true)}
        className="fixed top-3 right-3 z-50 h-10 min-w-10 px-3 rounded-xl border border-white/40 bg-white/50 backdrop-blur hover:bg-white/70 shadow"
        aria-label="Notifications"
      >
        <div className="relative">
          <Bell className="w-5 h-5 text-slate-700" />
          {notifs.length > 0 && (
            <span className="absolute -top-2 -right-2 text-[10px] rounded-full px-1.5 py-[2px] bg-rose-500 text-white shadow">
              {Math.min(99, notifs.length)}
            </span>
          )}
        </div>
      </button>

      {/* MOBILE: simple grid (no dragging) */}
      <div className="md:hidden mx-auto mt-16 px-3 pb-28">
        <div className="grid grid-cols-2 gap-3 justify-items-center">
          <SalesWidget value={salesMTD} onOpenReports={openReports} />
          <InventoryWidget value={inventoryCount} onOpenReports={openReports} />
          <ProfitWidget value={profitMTD} onOpenReports={openReports} />
          <NotificationsWidget items={notifs} onOpenAll={() => setOpenBell(true)} onOpenReports={openReports} />
        </div>
      </div>

      {/* DESKTOP: full-screen board, no limits/padding */}
      <div ref={containerRef} className="hidden md:block fixed inset-0 z-10">
        {/* Place widgets as absolute; user may drag anywhere */}
        <Draggable id="sales" containerRef={containerRef} initial={defaultPos.sales}>
          <SalesWidget value={salesMTD} onOpenReports={openReports} />
        </Draggable>

        <Draggable id="inventory" containerRef={containerRef} initial={defaultPos.inventory}>
          <InventoryWidget value={inventoryCount} onOpenReports={openReports} />
        </Draggable>

        <Draggable id="profit" containerRef={containerRef} initial={defaultPos.profit}>
          <ProfitWidget value={profitMTD} onOpenReports={openReports} />
        </Draggable>

        <Draggable id="notifications" containerRef={containerRef} initial={defaultPos.notifications}>
          <NotificationsWidget items={notifs} onOpenAll={() => setOpenBell(true)} onOpenReports={openReports} />
        </Draggable>
      </div>

      {/* Windows */}
      {showSettings && !minSettings && (
        <SettingsWindow
          zIndex={settingsZ}
          initialSize={{ w: 960, h: 600 }}
          centerOnOpen
          onClose={() => setShowSettings(false)}
          onMinimize={() => setMinSettings(true)}
          onFocus={bringSettingsToFront}
          initialSection="profile"
        />
      )}

      {showInventory && !minInventory && (
        <InventoryWindow
          zIndex={inventoryZ}
          initialSize={{ w: 960, h: 600 }}
          centerOnOpen
          onClose={() => setShowInventory(false)}
          onMinimize={() => setMinInventory(true)}
          onFocus={bringInventoryToFront}
        />
      )}

      {showAdd && !minAdd && (
        <AddMedicineWindow
          open={showAdd}
          zIndex={addZ}
          initialSection="add"
          onClose={() => setShowAdd(false)}
          onMinimize={() => setMinAdd(true)}
        />
      )}

      {showSell && !minSell && (
        <div onMouseDown={bringSellToFront}>
          <SellMedicineWindow
            open={showSell}
            zIndex={sellZ}
            centerOnOpen
            centerOffsets={{ top: 48, bottom: 80 }}
            onClose={() => setShowSell(false)}
            onMinimize={() => setMinSell(true)}
          />
        </div>
      )}

      {showReports && !minReports && (
        <ReportsWindow
          open={showReports}
          zIndex={reportsZ}
          centerOnOpen
          onClose={() => setShowReports(false)}
          onMinimize={() => setMinReports(true)}
          onFocus={bringReportsToFront}
        />
      )}

      {/* Dock */}
      <div
        className="fixed left-1/2 -translate-x-1/2 z-40 bottom-[calc(env(safe-area-inset-bottom,0)+12px)]
          rounded-2xl border border-white/10 bg-black/30 backdrop-blur-sm shadow-xl px-3 sm:px-4 py-2"
      >
        <div className="flex items-center gap-3 sm:gap-4">
          {apps.map((app) => (
            <DockIcon
              key={app.name}
              app={app}
              active={
                (app.name === 'Settings' && showSettings && !minSettings) ||
                (app.name === 'Inventory Management' && showInventory && !minInventory) ||
                (app.name === 'Add medicine' && showAdd && !minAdd) ||
                (app.name === 'Sell medicine' && showSell && !minSell) ||
                (app.name === 'Reports and Analytics' && showReports && !minReports)
              }
              minimized={
                (app.name === 'Settings' && minSettings) ||
                (app.name === 'Inventory Management' && minInventory) ||
                (app.name === 'Add medicine' && minAdd) ||
                (app.name === 'Sell medicine' && minSell) ||
                (app.name === 'Reports and Analytics' && minReports)
              }
              onClick={handleAppClick}
            />
          ))}
        </div>
      </div>

      {/* Bell side panel (all notifications) */}
      {openBell && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpenBell(false)} />
          <div className="absolute right-0 top-0 h-full w-[92vw] max-w-[420px] bg-white/90 backdrop-blur-xl border-l border-white/50 shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/60">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-slate-700" />
                <div className="font-semibold text-slate-800">Notifications</div>
              </div>
              <button className="rounded-md border border-white/60 bg-white/70 px-2 py-1 text-sm" onClick={() => setOpenBell(false)}>
                <X className="h-4 w-4 inline -mt-0.5 mr-1" /> Close
              </button>
            </div>
            <div className="p-3 overflow-y-auto h-[calc(100%-48px)]">
              {notifs.length === 0 ? (
                <div className="text-slate-600 text-sm">Nothing to show.</div>
              ) : (
                <ul className="space-y-2">
                  {notifs.map((n) => (
                    <li key={n.id} className="rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-[13px] text-slate-800">
                      <div className="flex items-center justify-between">
                        <span>{n.text}</span>
                        {n.time && <span className="text-[11px] text-slate-500">{new Date(n.time).toLocaleString()}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
