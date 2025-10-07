'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Rnd } from 'react-rnd';
import { Download, RefreshCw, Search, Layers3, Archive, TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* =========================================
   Types (stock + shelves only)
========================================= */

type Section = 'overview' | 'stock';

export type InventoryWindowProps = {
  zIndex?: number;
  initialPos?: { x: number; y: number };
  initialSize?: { w: number; h: number };
  onClose?: () => void;
  onMinimize?: () => void;
  onFocus?: () => void;
  initialSection?: Section;
  centerOnOpen?: boolean;
};

type ShelfAlloc = { shelfId: string; shelfName: string; qty: number };

type StockItem = {
  id: string;
  name: string;
  supplierName: string | null;
  batchNumber: string | null;
  manufacturingDate: string | null;
  expiryDate: string | null;
  purchasePrice: number;
  sellingPrice: number;
  qty: number;
  minQty: number;
  lastUpdated: string;
  shelves: ShelfAlloc[]; // per-shelf distribution
};

type ApiListResponse = { items?: Partial<StockItem>[]; error?: string };

/* =========================================
   Helpers
========================================= */

const toNum = (v: unknown): number => (v == null || v === '' ? 0 : Number(v));
const iso = (v?: string | null): Date | null => (v ? new Date(v) : null);

const fmtDate = (v?: string | null): string => {
  const d = iso(v);
  if (!d) return '-';
  return d.toLocaleDateString();
};

const daysUntil = (v?: string | null): number => {
  const d = iso(v);
  if (!d) return Number.POSITIVE_INFINITY;
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const csvEscape = (s: string) => `"${String(s).replace(/"/g, '""')}"`;

function hasKey<T extends object, K extends PropertyKey>(
  obj: T,
  key: K
): obj is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function normalize(p?: Partial<StockItem> | null): StockItem {
  const base = (p ?? {}) as Record<string, unknown>;

  const shelvesIn = Array.isArray(base.shelves) ? (base.shelves as unknown[]) : [];
  const shelves: ShelfAlloc[] = shelvesIn
    .map((raw): ShelfAlloc => {
      const s = (raw ?? {}) as Record<string, unknown>;
      return {
        shelfId: String((s.shelfId ?? '') as string),
        shelfName: String((s.shelfName ?? '') as string),
        qty: toNum(s.qty),
      };
    })
    .filter((s) => s.shelfId || s.shelfName);

  return {
    id: String((base.id ?? '') as string),
    name: String((base.name ?? '') as string),
    supplierName: typeof base.supplierName === 'string' ? (base.supplierName as string) : null,
    batchNumber: typeof base.batchNumber === 'string' ? (base.batchNumber as string) : null,
    manufacturingDate:
      typeof base.manufacturingDate === 'string' ? (base.manufacturingDate as string) : null,
    expiryDate: typeof base.expiryDate === 'string' ? (base.expiryDate as string) : null,
    purchasePrice: toNum(
      hasKey(base, 'purchasePrice') ? base.purchasePrice : hasKey(base, 'buyPrice') ? base.buyPrice : 0
    ),
    sellingPrice: toNum(
      hasKey(base, 'sellingPrice') ? base.sellingPrice : hasKey(base, 'sellPrice') ? base.sellPrice : 0
    ),
    qty: toNum(base.qty),
    minQty: toNum(
      hasKey(base, 'minQty')
        ? base.minQty
        : hasKey(base, 'reorderLevel')
        ? base.reorderLevel
        : hasKey(base, 'min_quantity')
        ? base.min_quantity
        : 0
    ),
    lastUpdated:
      typeof base.lastUpdated === 'string'
        ? (base.lastUpdated as string)
        : new Date().toISOString(),
    shelves,
  };
}

function useDebounce<T>(v: T, delay = 300): T {
  const [s, setS] = useState<T>(v);
  useEffect(() => {
    const t = setTimeout(() => setS(v), delay);
    return () => clearTimeout(t);
  }, [v, delay]);
  return s;
}

/* =========================================
   Component
========================================= */

export default function InventoryWindow({
  zIndex = 120,
  initialSize = { w: 980, h: 620 },
  initialPos = { x: 0, y: 0 },
  onClose,
  onMinimize,
  onFocus,
  initialSection = 'overview',
  centerOnOpen = true,
}: InventoryWindowProps) {
  const [viewport, setViewport] = useState({ w: 1024, h: 768 });
  const mobile = viewport.w < 768;

  // Use initialSection so it's not flagged as unused (also exposes a hook to add tabs later)
  const [section] = useState<Section>(initialSection); // eslint-disable-line @typescript-eslint/no-unused-vars

  useEffect(() => {
    const read = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);

  const [pos, setPos] = useState(initialPos);
  const [size, setSize] = useState(initialSize);
  const [maximized, setMaximized] = useState(false);

  const MIN_W = mobile ? 320 : 760;
  const MIN_H = 520;

  const frame = useMemo(() => {
    if (mobile) return { w: viewport.w, h: viewport.h };
    if (maximized) {
      const PAD = 12;
      return {
        w: Math.max(viewport.w - PAD * 2, MIN_W),
        h: Math.max(viewport.h - PAD * 2, MIN_H),
      };
    }
    return { w: Math.max(size.w, MIN_W), h: Math.max(size.h, MIN_H) };
  }, [mobile, maximized, viewport, size, MIN_W, MIN_H]);

  useEffect(() => {
    if (mobile || !centerOnOpen) return;
    const x = Math.max(8, Math.round((viewport.w - frame.w) / 2));
    const y = Math.max(8, Math.round((viewport.h - frame.h) / 2));
    setPos({ x, y });
  }, [mobile, centerOnOpen, viewport, frame]);

  const focus = () => onFocus?.();

  // data
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // filters
  const [q, setQ] = useState('');
  const [supplier, setSupplier] = useState<string>('all');
  const [shelf, setShelf] = useState<string>('all'); // shelf filter
  const [lowOnly, setLowOnly] = useState(false);
  const [expSoon, setExpSoon] = useState(false);
  const [sort, setSort] = useState<'name' | 'qty' | 'expiry' | 'updated'>('name');

  // paging
  const [page, setPage] = useState(1);
  const pageSize = 12;
  const dq = useDebounce(q, 300);

  const load = useCallback(async () => {
    setMsg(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory?view=stock&q=${encodeURIComponent(dq)}`, {
        credentials: 'include',
      });
      const data = (await res.json()) as ApiListResponse;
      if (!res.ok) throw new Error(data?.error ?? 'Failed to load inventory');
      setItems((data.items ?? []).map(normalize));
    } catch (e: unknown) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Network error' });
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [dq]);

  useEffect(() => {
    void load();
  }, [load]);

  // derived facets
  const suppliers = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => i.supplierName && s.add(i.supplierName));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const shelves = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => i.shelves.forEach((sh) => sh.shelfName && s.add(sh.shelfName)));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filtered = useMemo(() => {
    let r = items;
    if (supplier !== 'all') r = r.filter((i) => (i.supplierName ?? '') === supplier);
    if (shelf !== 'all') r = r.filter((i) => i.shelves.some((sh) => sh.shelfName === shelf));
    if (lowOnly) r = r.filter((i) => i.qty <= i.minQty);
    if (expSoon) r = r.filter((i) => daysUntil(i.expiryDate) <= 30);
    switch (sort) {
      case 'name':
        r = r.slice().sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'qty':
        r = r.slice().sort((a, b) => b.qty - a.qty);
        break;
      case 'expiry':
        r = r
          .slice()
          .sort((a, b) => daysUntil(a.expiryDate) - daysUntil(b.expiryDate));
        break;
      case 'updated':
        r = r
          .slice()
          .sort(
            (a, b) =>
              (iso(b.lastUpdated)?.getTime() ?? 0) - (iso(a.lastUpdated)?.getTime() ?? 0)
          );
        break;
    }
    return r;
  }, [items, supplier, shelf, lowOnly, expSoon, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => setPage(1), [supplier, shelf, lowOnly, expSoon, sort, dq]);

  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

  // KPIs + shelf totals
  const k = useMemo(() => {
    const totalSkus = items.length;
    const totalUnits = items.reduce((a, i) => a + i.qty, 0);
    const low = items.filter((i) => i.qty <= i.minQty).length;
    const exp = items.filter((i) => daysUntil(i.expiryDate) <= 30).length;
    const value = items.reduce((a, i) => a + i.qty * i.purchasePrice, 0);

    const shelfTotals = new Map<string, number>();
    items.forEach((i) =>
      i.shelves.forEach((s) => {
        shelfTotals.set(s.shelfName, (shelfTotals.get(s.shelfName) ?? 0) + s.qty);
      })
    );

    return { totalSkus, totalUnits, low, exp, value, shelfTotals };
  }, [items]);

  function exportCsv(): void {
    const headers = ['ID', 'Name', 'Supplier', 'Batch', 'Qty', 'MinQty', 'Expiry', 'Updated', 'ShelfBreakdown'];
    const rows = filtered.map((i) => {
      const breakdown = i.shelves.map((s) => `${s.shelfName}:${s.qty}`).join(' | ');
      return [
        i.id,
        i.name,
        i.supplierName ?? '-',
        i.batchNumber ?? '-',
        String(i.qty),
        String(i.minQty),
        fmtDate(i.expiryDate),
        fmtDate(i.lastUpdated),
        breakdown || '-',
      ];
    });
    const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inventory.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  /* --------- MOBILE --------- */
  if (mobile) {
    // type-safe CSS variable for z-index
    const mobileStyle: React.CSSProperties & Record<'--z', string | number> = { '--z': zIndex };

    return (
      <div
        className="fixed inset-0 z-[var(--z,120)] flex flex-col bg-white/30 backdrop-blur-xl"
        style={mobileStyle}
        onMouseDown={focus}
        data-section={section}
      >
        <header
          className="sticky top-0 z-10 border-b border-white/30 bg-white/70 backdrop-blur-xl"
          style={{ paddingTop: 'env(safe-area-inset-top,0)' }}
        >
          <div className="h-12 px-3 flex items-center gap-2">
            <button
              onClick={() => onClose?.()}
              className="px-2 py-1 text-[13px] text-slate-700 rounded hover:bg-black/5"
            >
              Close
            </button>
            <div className="mx-auto text-[15px] font-medium text-slate-900">Inventory</div>
            <div className="w-[52px]" />
          </div>
        </header>

        <div className="px-3 pt-2">
          <Filters
            compact
            q={q}
            setQ={setQ}
            supplier={supplier}
            setSupplier={setSupplier}
            suppliers={suppliers}
            shelf={shelf}
            setShelf={setShelf}
            shelves={shelves}
            lowOnly={lowOnly}
            setLowOnly={setLowOnly}
            expSoon={expSoon}
            setExpSoon={setExpSoon}
            sort={sort}
            setSort={setSort}
            onRefresh={load}
            loading={loading}
            onExport={exportCsv}
          />
        </div>

        <main className="flex-1 overflow-y-auto px-3 pb-[calc(12px+env(safe-area-inset-bottom,0))]">
          <Overview
            shelfTotals={k.shelfTotals}
            totalSkus={k.totalSkus}
            totalUnits={k.totalUnits}
            low={k.low}
            exp={k.exp}
            value={k.value}
          />
          <Table items={pageItems} page={page} totalPages={totalPages} setPage={setPage} msg={msg} />
        </main>
      </div>
    );
  }

  /* --------- DESKTOP (react-rnd glass) --------- */
  return (
    <Rnd
      default={{
        x: clamp(Math.round((viewport.w - frame.w) / 2), 8, viewport.w - frame.w - 8),
        y: clamp(Math.round((viewport.h - frame.h) / 2), 8, viewport.h - frame.h - 8),
        width: frame.w,
        height: frame.h,
      }}
      position={{ x: pos.x, y: pos.y }}
      size={{ width: frame.w, height: frame.h }}
      minWidth={MIN_W}
      minHeight={MIN_H}
      bounds="window"
      enableResizing={!mobile && !maximized}
      disableDragging={maximized}
      dragHandleClassName="ios-window-titlebar"
      onDragStop={(_, d) => setPos({ x: d.x, y: d.y })}
      onResizeStop={(_e, _dir, ref, _delta, newPos) => {
        setSize({ w: ref.offsetWidth, h: ref.offsetHeight });
        setPos({ x: newPos.x, y: newPos.y });
      }}
      style={{
        zIndex,
        position: 'absolute',
        overflow: 'hidden',
        borderRadius: 18,
        background: 'rgba(255,255,255,0.14)',
        backdropFilter: 'blur(22px) saturate(120%)',
        WebkitBackdropFilter: 'blur(22px) saturate(120%)',
        border: '1px solid rgba(255,255,255,0.28)',
        boxShadow: '0 18px 60px rgba(2,6,23,0.22)',
        color: '#0f172a',
        display: 'flex',
        flexDirection: 'column',
        maxWidth: 'calc(100vw - 16px)',
        maxHeight: 'calc(100dvh - 16px)',
      }}
      onMouseDown={focus}
      data-section={section}
    >
      <div className="ios-window-titlebar relative flex items-center justify-between px-3 py-2 border-b border-white/25 bg-white/20 text-slate-900 select-none">
        <div className="flex items-center gap-2">
          <button
            aria-label="Close"
            onClick={onClose}
            className="w-3.5 h-3.5 rounded-full"
            style={{ background: '#ff5f57' }}
          />
          <button
            aria-label="Minimize"
            onClick={onMinimize}
            className="w-3.5 h-3.5 rounded-full"
            style={{ background: '#febc2e' }}
          />
          <button
            aria-label="Zoom"
            onClick={() => setMaximized((v) => !v)}
            className="w-3.5 h-3.5 rounded-full"
            style={{ background: '#28c840' }}
          />
          <span className="ml-2 text-sm/5 text-slate-800/90">Inventory</span>
        </div>
        <div className="w-[60px]" />
      </div>

      <div className="px-3 pt-2">
        <Filters
          compact={false}
          q={q}
          setQ={setQ}
          supplier={supplier}
          setSupplier={setSupplier}
          suppliers={suppliers}
          shelf={shelf}
          setShelf={setShelf}
          shelves={shelves}
          lowOnly={lowOnly}
          setLowOnly={setLowOnly}
          expSoon={expSoon}
          setExpSoon={setExpSoon}
          sort={sort}
          setSort={setSort}
          onRefresh={load}
          loading={loading}
          onExport={exportCsv}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 md:p-4">
        <Overview
          shelfTotals={k.shelfTotals}
          totalSkus={k.totalSkus}
          totalUnits={k.totalUnits}
          low={k.low}
          exp={k.exp}
          value={k.value}
        />
        <Table items={pageItems} page={page} totalPages={totalPages} setPage={setPage} msg={msg} />
      </div>
    </Rnd>
  );
}

/* ---------- Subcomponents ---------- */

function Overview({
  shelfTotals,
  totalSkus,
  totalUnits,
  low,
  exp,
  value,
}: {
  shelfTotals: Map<string, number>;
  totalSkus: number;
  totalUnits: number;
  low: number;
  exp: number; // expiring within 30 days
  value: number;
}) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <GlassCard
          title="Total SKUs"
          value={totalSkus.toLocaleString()}
          icon={<Archive className="h-4 w-4" />}
        />
        <GlassCard
          title="Units in Stock"
          value={totalUnits.toLocaleString()}
          icon={<Layers3 className="h-4 w-4" />}
        />
        <GlassCard
          title="Low Stock (items)"
          value={low.toLocaleString()}
          icon={<TriangleAlert className="h-4 w-4" />}
        />
        <GlassCard
          title="Inventory Value"
          value={`NPR ${value.toFixed(2)}`}
          icon={<Archive className="h-4 w-4" />}
        />
      </div>

      <div className="mb-3">
        <GlassCard
          title="Expiring ≤ 30 days"
          value={exp.toLocaleString()}
          icon={<TriangleAlert className="h-4 w-4" />}
        />
      </div>

      {/* Per-shelf totals */}
      <Card className="bg-white/55 backdrop-blur-lg border-white/40 mb-3">
        <CardHeader className="py-3">
          <CardTitle className="text-lg text-slate-900">Shelf Totals</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          {shelfTotals.size === 0 ? (
            <p className="text-sm text-slate-600">No shelf data.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {Array.from(shelfTotals.entries()).map(([name, qty]) => (
                <div
                  key={name}
                  className="flex items-center justify-between rounded-lg border border-white/40 bg-white/60 px-3 py-2"
                >
                  <div className="text-sm text-slate-700">{name}</div>
                  <div className="text-sm font-semibold text-slate-900">{qty}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function GlassCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/35 bg-white/55 backdrop-blur-2xl shadow-[0_8px_28px_rgba(2,6,23,0.10)] p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-700">
          <div className="h-7 w-7 rounded-lg grid place-items-center bg-gradient-to-br from-white/70 to-white/30 border border-white/40">
            {icon}
          </div>
          <div className="text-[12px]">{title}</div>
        </div>
        <div className="text-sm font-semibold text-slate-900">{value}</div>
      </div>
    </div>
  );
}

function Filters(props: {
  compact: boolean;
  q: string;
  setQ: (v: string) => void;
  supplier: string;
  setSupplier: (v: string) => void;
  suppliers: string[];
  shelf: string;
  setShelf: (v: string) => void;
  shelves: string[];
  lowOnly: boolean;
  setLowOnly: (v: boolean) => void;
  expSoon: boolean;
  setExpSoon: (v: boolean) => void;
  sort: 'name' | 'qty' | 'expiry' | 'updated';
  setSort: (v: 'name' | 'qty' | 'expiry' | 'updated') => void;
  onRefresh: () => void;
  loading: boolean;
  onExport: () => void;
}) {
  const {
    compact,
    q,
    setQ,
    supplier,
    setSupplier,
    suppliers,
    shelf,
    setShelf,
    shelves,
    lowOnly,
    setLowOnly,
    expSoon,
    setExpSoon,
    sort,
    setSort,
    onRefresh,
    loading,
    onExport,
  } = props;

  const onSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === 'name' || val === 'qty' || val === 'expiry' || val === 'updated') {
      setSort(val);
    }
  };

  return (
    <div
      className={`rounded-2xl border border-white/35 bg-white/45 backdrop-blur-2xl px-3 py-2 ${
        compact ? 'space-y-2' : ''
      }`}
    >
      <div className={`flex ${compact ? 'flex-col gap-2' : 'flex-wrap gap-2 items-center'}`}>
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            value={q}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
            placeholder="Search by ID, name, batch, supplier…"
            className="pl-8 h-9"
          />
        </div>

        <div className="flex items-center gap-2">
          <Label className="text-xs text-slate-600">Supplier</Label>
          <select
            className="h-9 rounded-lg border border-white/40 bg-white/70 px-2 text-sm"
            value={supplier}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSupplier(e.target.value)}
          >
            <option value="all">All</option>
            {suppliers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Label className="text-xs text-slate-600">Shelf</Label>
          <select
            className="h-9 rounded-lg border border-white/40 bg-white/70 px-2 text-sm"
            value={shelf}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setShelf(e.target.value)}
          >
            <option value="all">All</option>
            {shelves.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={lowOnly}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLowOnly(e.target.checked)}
          />
          Low stock only
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={expSoon}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExpSoon(e.target.checked)}
          />
          Expiring ≤ 30d
        </label>

        <div className="flex items-center gap-2">
          <Label className="text-xs text-slate-600">Sort</Label>
          <select
            className="h-9 rounded-lg border border-white/40 bg-white/70 px-2 text-sm"
            value={sort}
            onChange={onSortChange}
          >
            <option value="name">Name (A–Z)</option>
            <option value="qty">Quantity (High→Low)</option>
            <option value="expiry">Expiry (Soonest)</option>
            <option value="updated">Last Updated</option>
          </select>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <Button variant="outline" className="h-9" onClick={onRefresh}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button className="h-9" onClick={onExport}>
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
        </div>
      </div>
    </div>
  );
}

function Table({
  items,
  page,
  totalPages,
  setPage,
  msg,
}: {
  items: StockItem[];
  page: number;
  totalPages: number;
  setPage: (n: number) => void;
  msg: { kind: 'ok' | 'err'; text: string } | null;
}) {
  return (
    <Card className="bg-white/55 backdrop-blur-lg border-white/40">
      <CardHeader className="py-3">
        <CardTitle className="text-lg text-slate-900">Stock (with Shelves)</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-left text-[13px] text-slate-800">
            <thead className="bg-white/70">
              <tr>
                <Th>ID</Th>
                <Th>Name</Th>
                <Th>Supplier</Th>
                <Th>Qty</Th>
                <Th>Reorder</Th>
                <Th>Expiry</Th>
                <Th>Shelves (name:qty)</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-slate-500" colSpan={8}>
                    No items
                  </td>
                </tr>
              ) : (
                items.map((i) => {
                  const low = i.qty <= i.minQty;
                  const d = daysUntil(i.expiryDate);
                  const expLabel =
                    d === Number.POSITIVE_INFINITY ? '-' : d < 0 ? 'Expired' : `${d}d`;
                  return (
                    <tr key={`${i.id}-${i.batchNumber ?? ''}`} className="odd:bg-white/50">
                      <Td className="font-medium">{i.id}</Td>
                      <Td>{i.name}</Td>
                      <Td>{i.supplierName ?? '-'}</Td>
                      <Td className={low ? 'text-rose-600 font-semibold' : ''}>{i.qty}</Td>
                      <Td>{i.minQty || '-'}</Td>
                      <Td>{expLabel}</Td>
                      <Td>
                        {i.shelves.length === 0
                          ? '-'
                          : i.shelves.map((s) => `${s.shelfName}:${s.qty}`).join(' | ')}
                      </Td>
                      <Td>{fmtDate(i.lastUpdated)}</Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {msg && (
          <div
            className={`px-3 py-2 text-sm ${
              msg.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {msg.text}
          </div>
        )}

        <div className="flex items-center justify-between px-3 py-2 border-t border-white/40 bg-white/60">
          <div className="text-xs text-slate-600">
            Page {page} of {totalPages}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-8 px-3"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              className="h-8 px-3"
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-xs font-semibold text-slate-600 ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
