'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Rnd } from 'react-rnd';
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, Pie, PieChart, Tooltip,
  XAxis, YAxis, ResponsiveContainer, Legend, Cell
} from 'recharts';
import type { PieLabelRenderProps } from 'recharts';
import { Download, Filter, RefreshCw, ChevronRight, Calendar, TrendingUp, Package, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
type PieLabelProps = { percent?: number | string; name?: string | number };


/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
type Section = 'overview' | 'sales' | 'inventory' | 'alerts';

export type ReportsWindowProps = {
  open: boolean;
  zIndex?: number;
  onClose?: () => void;
  onMinimize?: () => void;
  onFocus?: () => void;
  /** center on open; default true */
  centerOnOpen?: boolean;
};

type TrendPoint = { date: string; sales: number; profit: number };
type TopItem = { name: string; qty: number; revenue: number };
type Category = { name: string; value: number };
type Aging = { bucket: string; qty: number };
type Summary = { revenue: number; profit: number; orders: number; items: number };
type AlertRow = { id: string; name: string; qty: number; expiry?: string | null };

type ApiReports = {
  trend: TrendPoint[];
  top: TopItem[];
  cats: Category[];
  aging: Aging[];
  alerts: AlertRow[];
  summary: Summary;
  error?: string;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const money = (n: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const short = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
  : String(n);

const COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#f472b6'];

/* typed label renderers to avoid 'any' */
const labelNamePct = ({ percent, name }: PieLabelProps) => {
  const p = typeof percent === 'number' ? percent : Number(percent) || 0;
  const pct = Math.round(p * 100);
  const n = typeof name === 'string' ? name : '';
  return `${n} ${pct}%`;
};

const labelPctOnly = ({ percent }: PieLabelProps) => {
  const p = typeof percent === 'number' ? percent : Number(percent) || 0;
  return `${Math.round(p * 100)}%`;
};

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */
export default function ReportsWindow({
  open,
  zIndex = 150,
  onClose,
  onMinimize,
  onFocus,
  centerOnOpen = true,
}: ReportsWindowProps) {
  /* viewport + centering (hooks always top-level) */
  const [viewport, setViewport] = useState({ w: 1280, h: 800 });
  useEffect(() => {
    const read = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);
  const mobile = viewport.w <= 480;

  // window sizing
  const MIN_W = 640;
  const MIN_H = 520;
  const DEF_W = Math.min(760, viewport.w - 24);
  const DEF_H = Math.min(560, viewport.h - 24);

  const [size, setSize] = useState<{ w: number; h: number }>({ w: DEF_W, h: DEF_H });
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    const x = Math.max(12, Math.round((viewport.w - DEF_W) / 2));
    const y = Math.max(12, Math.round((viewport.h - DEF_H) / 2));
    return centerOnOpen ? { x, y } : { x: 20, y: 20 };
  });
  const [maximized, setMaximized] = useState(false);

  // re-center on resize when not maximized (no function deps → no missing-deps warning)
  useEffect(() => {
    if (maximized || mobile || !centerOnOpen) return;
    const w = Math.min(760, viewport.w - 24);
    const h = Math.min(560, viewport.h - 24);
    const x = Math.max(12, Math.round((viewport.w - w) / 2));
    const y = Math.max(12, Math.round((viewport.h - h) / 2));
    setSize({ w, h });
    setPos({ x, y });
  }, [viewport.w, viewport.h, maximized, mobile, centerOnOpen]);

  /* tabs */
  const [section, setSection] = useState<Section>('overview');

  /* filters */
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [from, setFrom] = useState(firstOfMonth.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  /* data */
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [top, setTop] = useState<TopItem[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [aging, setAging] = useState<Aging[]>([]);
  const [summary, setSummary] = useState<Summary>({ revenue: 0, profit: 0, orders: 0, items: 0 });
  const [alerts, setAlerts] = useState<AlertRow[]>([]);

  /* data loader */
  async function tryFetchFromApi(rangeFrom: string, rangeTo: string): Promise<ApiReports | null> {
    try {
      const res = await fetch(`/api/reports?from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const data = (await res.json()) as ApiReports;
      if (!res.ok || data?.error) throw new Error(data?.error || 'Failed to fetch');
      return data;
    } catch (e) {
      setErrorText((e as Error).message || 'Failed to load reports from server. Showing sample data.');
      return null;
    }
  }

  function makeMock(rangeFrom: string, rangeTo: string): ApiReports {
    const seed = (str: string) => str.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const s = seed(`${rangeFrom}:${rangeTo}`);
    const rnd = (i: number, base: number, spread: number) => Math.max(0, Math.round(base + Math.sin((s + i) * 0.3) * spread));
    const days = 14;
    const now = new Date();
    const trendArr: TrendPoint[] = Array.from({ length: days }).map((_, i) => {
      const d = new Date(now); d.setDate(d.getDate() - (days - 1 - i));
      const sales = rnd(i, 10000, 3500) + i * 120;
      const profit = Math.round(sales * (0.18 + ((i % 5) - 2) * 0.01));
      return { date: d.toLocaleDateString(), sales, profit };
    });

    const topList: TopItem[] = [
      { name: 'Paracetamol 500mg', qty: 420 + (s % 30), revenue: 42000 + (s % 1500) },
      { name: 'Amoxicillin 250mg', qty: 380 + (s % 25), revenue: 39000 + (s % 1200) },
      { name: 'Ibuprofen 200mg',   qty: 300 + (s % 20), revenue: 24000 + (s % 900) },
      { name: 'Cetirizine 10mg',   qty: 210 + (s % 18), revenue: 15000 + (s % 600) },
      { name: 'ORS Pack',          qty: 180 + (s % 15), revenue: 12000 + (s % 500) },
    ];
    const catShare: Category[] = [
      { name: 'Antibiotics', value: 32 },
      { name: 'Pain Relief', value: 28 },
      { name: 'Allergy',     value: 14 },
      { name: 'GI',          value: 10 },
      { name: 'Vitamins',    value: 16 },
    ];
    const agingBuckets: Aging[] = [
      { bucket: '0–30d',  qty: 860 },
      { bucket: '31–60d', qty: 610 },
      { bucket: '61–90d', qty: 410 },
      { bucket: '90–180d', qty: 260 },
      { bucket: '180+d',   qty: 120 },
    ];
    const alertsList: AlertRow[] = [
      { id: 'MED-00123', name: 'Amoxicillin 250mg', qty: 6 },
      { id: 'MED-00654', name: 'Insulin Pen', qty: 2, expiry: new Date(Date.now() + 1000*60*60*24*28).toISOString().slice(0,10) },
      { id: 'MED-00321', name: 'Ibuprofen 200mg', qty: 9 },
    ];

    const revenue = trendArr.reduce((a, x) => a + x.sales, 0);
    const profit  = trendArr.reduce((a, x) => a + x.profit, 0);
    const summary: Summary = { revenue, profit, orders: 210 + (s % 25), items: topList.reduce((a, x) => a + x.qty, 0) };

    return { trend: trendArr, top: topList, cats: catShare, aging: agingBuckets, alerts: alertsList, summary };
  }

  const load = useCallback(async () => {
    setLoading(true);
    setErrorText(null);
    const api = await tryFetchFromApi(from, to);
    const data = api ?? makeMock(from, to);
    setTrend(data.trend);
    setTop(data.top);
    setCats(data.cats);
    setAging(data.aging);
    setAlerts(data.alerts);
    setSummary(data.summary);
    setLoading(false);
  }, [from, to]);

  useEffect(() => { void load(); }, [load]); // initial + whenever range changes via Apply

  const apply = () => void load();

  /* export CSV (quick) */
  function exportCSV() {
    const rows = [
      ['Date','Sales','Profit'],
      ...trend.map(t => [t.date, t.sales, t.profit]),
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `sales_${from}_${to}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  const DRAG_HANDLE = 'reports-titlebar';
  const DRAG_CANCEL = '.reports-content, .reports-content *';

  const sectionIcons: Record<Section, React.ComponentType<{ className?: string }>> = {
    overview: TrendingUp,
    sales: TrendingUp,
    inventory: Package,
    alerts: AlertCircle
  };

  /* ----------------------------- RENDER ----------------------------- */

  // Mobile content
  const mobileContent = (
    <div className="fixed inset-0 z-[160] flex flex-col bg-black/60">
      {/* Header */}
      <div className="px-3 py-2 text-sm text-white/90 flex items-center justify-between">
        <div className="font-medium">Reports</div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" className="h-7 px-2" onClick={exportCSV} title="Export CSV">
            <Download className="h-4 w-4" />
          </Button>
          <button onClick={onClose} className="rounded px-2 py-1 bg-white/70 border border-white/40 text-xs text-slate-900">
            Close
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 rounded-t-2xl bg-white/85 backdrop-blur-xl overflow-hidden border-t border-white/30">
        {/* Filter bar */}
        <div className="px-3 py-2 border-b border-white/40 bg-white/60">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-slate-600" />
            <Input type="date" value={from} onChange={e=>setFrom(e.target.value)} className="h-8" />
            <span className="text-xs text-slate-600">to</span>
            <Input type="date" value={to} onChange={e=>setTo(e.target.value)} className="h-8" />
            <Button variant="outline" className="h-8 ml-auto" onClick={apply} disabled={loading}>
              <Filter className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          {errorText && (
            <div className="mt-2 rounded-md border border-amber-300/80 bg-amber-50/80 text-amber-800 px-3 py-2 text-xs">
              {errorText}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="h-[calc(100%-96px)] overflow-y-auto p-3">
          {section === 'overview' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <StatCard title="Revenue" value={money(summary.revenue)} trend="up" />
                <StatCard title="Profit"  value={money(summary.profit)}  trend="up" />
                <StatCard title="Orders"  value={short(summary.orders)} trend="neutral" />
                <StatCard title="Items"   value={short(summary.items)}  trend="up" />
              </div>

              <Card className="mt-3 bg-white/70 backdrop-blur border-white/50">
                <CardHeader className="py-3 flex items-center justify-between">
                  <CardTitle className="text-base">Sales & Profit</CardTitle>
                  <Button variant="outline" className="h-8" onClick={apply}>
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  </Button>
                </CardHeader>
                <CardContent className="p-3">
                  <div className="h-[220px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trend}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="sales" stroke="#60a5fa" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="profit" stroke="#34d399" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card className="mt-3 bg-white/70 backdrop-blur border-white/50">
                <CardHeader className="py-3"><CardTitle className="text-base">Top Products</CardTitle></CardHeader>
                <CardContent className="p-3">
                  <div className="h-[220px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={top}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="qty" fill="#60a5fa" name="Qty" />
                        <Bar dataKey="revenue" fill="#34d399" name="Revenue" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card className="mt-3 bg-white/70 backdrop-blur border-white/50">
                <CardHeader className="py-3"><CardTitle className="text-base">Category Share</CardTitle></CardHeader>
                <CardContent className="p-3">
                  <div className="h-[220px] w-full grid place-items-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Tooltip />
                        <Legend />
                        <Pie
                          data={cats}
                          dataKey="value"
                          nameKey="name"
                          outerRadius={80}
                          innerRadius={40}
                          label={labelNamePct}
                          labelLine={false}
                        >
                          {cats.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="rgba(255,255,255,0.8)" strokeWidth={2} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {section === 'sales' && (
            <Card className="bg-white/70 backdrop-blur border-white/50">
              <CardHeader className="py-3 flex items-center justify-between">
                <CardTitle className="text-base">Sales Details</CardTitle>
                <div className="flex gap-2">
                  <Button className="h-8 px-3" onClick={exportCSV}><Download className="h-4 w-4 mr-1" />CSV</Button>
                  <Button variant="outline" className="h-8" onClick={apply}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></Button>
                </div>
              </CardHeader>
              <CardContent className="p-3">
                <div className="rounded-lg border border-white/40 bg-white/60 overflow-hidden">
                  <div className="max-h-[48vh] overflow-auto">
                    <table className="min-w-[600px] w-full text-left text-[13px]">
                      <thead className="bg-white/70 sticky top-0 z-10">
                        <tr><Th>Date</Th><Th>Sales</Th><Th>Profit</Th><Th>Margin</Th></tr>
                      </thead>
                      <tbody>
                        {trend.map((t, i) => (
                          <tr key={i} className="odd:bg-white/50">
                            <Td className="font-medium">{t.date}</Td>
                            <Td>{money(t.sales)}</Td>
                            <Td>{money(t.profit)}</Td>
                            <Td>{((t.profit / (t.sales || 1)) * 100).toFixed(1)}%</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {section === 'inventory' && (
            <div className="space-y-3">
              <Card className="bg-white/70 backdrop-blur border-white/50">
                <CardHeader className="py-3"><CardTitle className="text-base">Inventory Aging</CardTitle></CardHeader>
                <CardContent className="p-3">
                  <div className="h-[220px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={aging}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="bucket" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="qty" fill="#60a5fa" radius={[4,4,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-white/70 backdrop-blur border-white/50">
                <CardHeader className="py-3"><CardTitle className="text-base">Category Distribution</CardTitle></CardHeader>
                <CardContent className="p-3">
                  <div className="h-[220px] w-full grid place-items-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Tooltip />
                        <Legend />
                        <Pie
                          data={cats}
                          dataKey="value"
                          nameKey="name"
                          outerRadius={80}
                          innerRadius={50}
                          label={labelPctOnly}
                          labelLine={false}
                        >
                          {cats.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="rgba(255,255,255,0.8)" strokeWidth={2} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {section === 'alerts' && (
            <Card className="bg-white/70 backdrop-blur border-white/50">
              <CardHeader className="py-3"><CardTitle className="text-base">Low Stock & Expiry Alerts</CardTitle></CardHeader>
              <CardContent className="p-3">
                <div className="rounded-lg border border-white/40 bg-white/60 overflow-hidden">
                  <div className="max-h-[48vh] overflow-auto">
                    <table className="min-w-[620px] w-full text-left text-[13px]">
                      <thead className="bg-white/70 sticky top-0 z-10">
                        <tr><Th>ID</Th><Th>Product</Th><Th>Qty</Th><Th>Expiry</Th><Th>Status</Th></tr>
                      </thead>
                      <tbody>
                        {alerts.length === 0 ? (
                          <tr><td className="px-3 py-3 text-slate-500 text-center" colSpan={5}>No alerts 🎉</td></tr>
                        ) : alerts.map((a) => {
                          const isCritical = a.qty <= 5;
                          const isExpiring = a.expiry && new Date(a.expiry) < new Date(Date.now() + 30*24*60*60*1000);
                          return (
                            <tr key={a.id} className="odd:bg-white/50">
                              <Td className="font-mono">{a.id}</Td>
                              <Td>{a.name}</Td>
                              <Td className={isCritical ? 'text-rose-600 font-semibold' : ''}>{a.qty}</Td>
                              <Td className={isExpiring ? 'text-amber-600 font-medium' : 'text-slate-500'}>{a.expiry ?? '-'}</Td>
                              <Td>
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                  isCritical ? 'bg-rose-100 text-rose-700' :
                                  isExpiring ? 'bg-amber-100 text-amber-700' :
                                  'bg-slate-100 text-slate-700'
                                }`}>
                                  {isCritical ? 'Critical' : isExpiring ? 'Expiring' : 'Low Stock'}
                                </span>
                              </Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Bottom tabs */}
        <div className="grid grid-cols-4 gap-1 border-t border-white/40 bg-white/70">
          {(['overview','sales','inventory','alerts'] as Section[]).map((s) => {
            const Icon = sectionIcons[s];
            const active = section === s;
            return (
              <button
                key={s}
                onClick={() => setSection(s)}
                className={`py-2 text-[11px] flex flex-col items-center ${active ? 'font-semibold text-slate-900' : 'text-slate-600'}`}
              >
                <Icon className={`h-4 w-4 mb-0.5 ${active ? 'text-blue-600' : 'text-slate-500'}`} />
                {s}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  // Desktop content
  const desktopContent = (
    <Rnd
      position={{ x: maximized ? 12 : pos.x, y: maximized ? 12 : pos.y }}
      size={{
        width: maximized ? Math.max(viewport.w - 24, MIN_W) : size.w,
        height: maximized ? Math.max(viewport.h - 24, MIN_H) : size.h,
      }}
      minWidth={MIN_W}
      minHeight={MIN_H}
      bounds="window"
      dragHandleClassName={DRAG_HANDLE}
      cancel={DRAG_CANCEL}
      enableResizing={!maximized}
      onDragStart={() => onFocus?.()}
      onResizeStart={() => onFocus?.()}
      onDragStop={(_, d) => { setPos({ x: d.x, y: d.y }); onFocus?.(); }}
      onResizeStop={(_e, _dir, ref, _delta, newPos) => {
        setSize({ w: ref.offsetWidth, h: ref.offsetHeight });
        setPos({ x: newPos.x, y: newPos.y });
        onFocus?.();
      }}
      style={{
        zIndex,
        position: 'fixed',
        borderRadius: 18,
        background: 'rgba(255,255,255,0.14)',
        backdropFilter: 'blur(22px) saturate(120%)',
        WebkitBackdropFilter: 'blur(22px) saturate(120%)',
        border: '1px solid rgba(255,255,255,0.28)',
        boxShadow: '0 18px 60px rgba(2,6,23,0.22)',
        color: '#0f172a',
        display: 'flex',
        flexDirection: 'column',
        maxWidth: 'calc(100vw - 12px)',
        maxHeight: 'calc(100dvh - 12px)',
        overflow: 'hidden',
      }}
      onMouseDown={() => onFocus?.()}
    >
      {/* Titlebar */}
      <div className="reports-titlebar flex items-center justify-between px-3 py-2 border-b border-white/25 bg-white/25 select-none">
        <div className="flex items-center gap-2">
          <button aria-label="Close" onClick={onClose} className="w-3.5 h-3.5 rounded-full" style={{ background: '#ff5f57' }} />
          <button aria-label="Minimize" onClick={onMinimize} className="w-3.5 h-3.5 rounded-full" style={{ background: '#febc2e' }} />
          <button aria-label="Zoom" onClick={() => setMaximized(v => !v)} className="w-3.5 h-3.5 rounded-full" style={{ background: '#28c840' }} title="Zoom" />
          <span className="ml-2 text-sm/5 font-medium">Reports & Analytics</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2">
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-8 w-[120px]" />
            <span className="text-xs text-slate-600">to</span>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-8 w-[120px]" />
          </div>
          <Button variant="outline" className="h-8" onClick={apply} disabled={loading}>
            <Filter className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="outline" className="h-8" onClick={exportCSV}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="reports-content flex-1 min-h-0 grid grid-cols-[200px_1fr]">
        {/* Sidebar */}
        <aside className="border-r border-white/25 bg-white/35 p-2">
          {(['overview','sales','inventory','alerts'] as Section[]).map(key => {
            const Icon = sectionIcons[key];
            return (
              <button
                key={key}
                onClick={() => setSection(key)}
                className={`w-full text-left rounded-lg px-3 py-2 mb-1 text-sm capitalize ${
                  section === key ? 'bg-white/80 font-medium' : 'hover:bg-white/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${section === key ? 'text-blue-600' : 'text-slate-600'}`} />
                    {key}
                  </div>
                  {section === key && <ChevronRight className="h-4 w-4 text-slate-400" />}
                </div>
              </button>
            );
          })}
        </aside>

        {/* Right pane */}
        <div className="min-h-0 p-3 md:p-4 overflow-auto space-y-4">
          {errorText && (
            <div className="rounded-md border border-amber-300/80 bg-amber-50/80 text-amber-800 px-3 py-2 text-sm">
              {errorText}
            </div>
          )}

          {section === 'overview' && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard title="Revenue" value={money(summary.revenue)} />
                <StatCard title="Profit" value={money(summary.profit)} />
                <StatCard title="Orders" value={short(summary.orders)} />
                <StatCard title="Items Sold" value={short(summary.items)} />
              </div>

              <Card className="bg-white/60 backdrop-blur-lg border-white/40">
                <CardHeader className="py-3 flex items-center justify-between">
                  <CardTitle className="text-lg">Sales & Profit Trend</CardTitle>
                  <Button variant="outline" className="h-8" onClick={apply}>
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  </Button>
                </CardHeader>
                <CardContent className="p-3 md:p-4">
                  <div className="h-[260px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trend}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="sales" stroke="#60a5fa" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="profit" stroke="#34d399" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card className="bg-white/60 backdrop-blur-lg border-white/40">
                  <CardHeader className="py-3"><CardTitle className="text-lg">Top Products</CardTitle></CardHeader>
                  <CardContent className="p-3 md:p-4">
                    <div className="h-[240px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={top}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="qty" fill="#60a5fa" name="Qty" />
                          <Bar dataKey="revenue" fill="#34d399" name="Revenue" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-white/60 backdrop-blur-lg border-white/40">
                  <CardHeader className="py-3"><CardTitle className="text-lg">Category Share</CardTitle></CardHeader>
                  <CardContent className="p-3 md:p-4">
                    <div className="h-[240px] w-full grid place-items-center">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Tooltip />
                          <Legend />
                          <Pie
                            data={cats}
                            dataKey="value"
                            nameKey="name"
                            outerRadius={90}
                            innerRadius={45}
                            label={labelNamePct}
                            labelLine={false}
                          >
                            {cats.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="rgba(255,255,255,0.8)" strokeWidth={2} />)}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          )}

          {section === 'sales' && (
            <Card className="bg-white/60 backdrop-blur-lg border-white/40">
              <CardHeader className="py-3 flex items-center justify-between">
                <CardTitle className="text-lg">Sales Details</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" className="h-8" onClick={exportCSV}><Download className="h-4 w-4 mr-1"/>CSV</Button>
                  <Button variant="outline" className="h-8" onClick={apply}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}/></Button>
                </div>
              </CardHeader>
              <CardContent className="p-3 md:p-4">
                <div className="rounded-lg border border-white/40 bg-white/60 overflow-hidden">
                  <div className="max-h-[42vh] overflow-auto">
                    <table className="min-w-[680px] w-full text-left text-[13px]">
                      <thead className="bg-white/70 sticky top-0 z-10">
                        <tr><Th>Date</Th><Th>Sales</Th><Th>Profit</Th><Th>Margin</Th></tr>
                      </thead>
                      <tbody>
                        {trend.map((t, i) => (
                          <tr key={i} className="odd:bg-white/50">
                            <Td className="font-medium">{t.date}</Td>
                            <Td>{money(t.sales)}</Td>
                            <Td>{money(t.profit)}</Td>
                            <Td>{((t.profit / (t.sales || 1)) * 100).toFixed(1)}%</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {section === 'inventory' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="bg-white/60 backdrop-blur-lg border-white/40">
                <CardHeader className="py-3"><CardTitle className="text-lg">Inventory Aging</CardTitle></CardHeader>
                <CardContent className="p-3 md:p-4">
                  <div className="h-[240px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={aging}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="bucket" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="qty" fill="#60a5fa" radius={[4,4,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-white/60 backdrop-blur-lg border-white/40">
                <CardHeader className="py-3"><CardTitle className="text-lg">Category Distribution</CardTitle></CardHeader>
                <CardContent className="p-3 md:p-4">
                  <div className="h-[240px] w-full grid place-items-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Tooltip />
                        <Legend />
                        <Pie
                          data={cats}
                          dataKey="value"
                          nameKey="name"
                          outerRadius={90}
                          innerRadius={55}
                          label={labelPctOnly}
                          labelLine={false}
                        >
                          {cats.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="rgba(255,255,255,0.8)" strokeWidth={2} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {section === 'alerts' && (
            <Card className="bg-white/60 backdrop-blur-lg border-white/40">
              <CardHeader className="py-3"><CardTitle className="text-lg">Low Stock & Expiry Alerts</CardTitle></CardHeader>
              <CardContent className="p-3 md:p-4">
                <div className="rounded-lg border border-white/40 bg-white/60 overflow-hidden">
                  <div className="max-h-[42vh] overflow-auto">
                    <table className="min-w-[680px] w-full text-left text-[13px]">
                      <thead className="bg-white/70 sticky top-0 z-10">
                        <tr><Th>ID</Th><Th>Product</Th><Th>Qty</Th><Th>Expiry</Th><Th>Status</Th></tr>
                      </thead>
                      <tbody>
                        {alerts.length === 0 ? (
                          <tr><td className="px-3 py-3 text-slate-500 text-center" colSpan={5}>No alerts 🎉</td></tr>
                        ) : alerts.map((a) => {
                          const isCritical = a.qty <= 5;
                          const isExpiring = a.expiry && new Date(a.expiry) < new Date(Date.now() + 30*24*60*60*1000);
                          return (
                            <tr key={a.id} className="odd:bg-white/50">
                              <Td className="font-mono">{a.id}</Td>
                              <Td>{a.name}</Td>
                              <Td className={isCritical ? 'text-rose-600 font-semibold' : ''}>{a.qty}</Td>
                              <Td className={isExpiring ? 'text-amber-600 font-medium' : 'text-slate-500'}>{a.expiry ?? '-'}</Td>
                              <Td>
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                  isCritical ? 'bg-rose-100 text-rose-700' :
                                  isExpiring ? 'bg-amber-100 text-amber-700' :
                                  'bg-slate-100 text-slate-700'
                                }`}>
                                  {isCritical ? 'Critical' : isExpiring ? 'Expiring' : 'Low Stock'}
                                </span>
                              </Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </Rnd>
  );

  // single return → hooks are never conditional
  if (!open) return null;
  return mobile ? mobileContent : desktopContent;
}

/* small bits */
type TrendDir = 'up' | 'down' | 'neutral';

function StatCard({
  title,
  value,
  trend,
}: {
  title: string;
  value: string;
  trend?: TrendDir;
}) {
  const tone =
    trend === 'up' ? 'text-green-600' :
    trend === 'down' ? 'text-red-600' :
    'text-slate-400';

  const arrow = trend === 'up' ? '↗' : trend === 'down' ? '↘' : '→';

  return (
    <div className="rounded-2xl border border-white/40 bg-gradient-to-br from-white/60 to-white/40 p-5 backdrop-blur shadow-sm hover:shadow-md transition-all duration-200">
      <div className="text-xs font-medium text-slate-600 uppercase tracking-wide">{title}</div>
      <div className="text-2xl font-bold text-slate-900 mt-2 mb-1">{value}</div>
      {trend && (
        <div className={`text-xs font-medium flex items-center gap-1 ${tone}`}>
          {arrow} {trend === 'neutral' ? 'Stable' : 'Trending'}
        </div>
      )}
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-xs font-semibold text-slate-600 ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
