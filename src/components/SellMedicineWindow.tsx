'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import { Search, RefreshCw, QrCode, X, Trash2, Check, Minus, Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/* ───────────────────────── Types ───────────────────────── */

type Section = 'sell' | 'history';

export type SellMedicineWindowProps = {
  open: boolean;
  zIndex?: number;
  onClose?: () => void;
  onMinimize?: () => void;
  initialSection?: Section;
  centerOnOpen?: boolean;
  /** offsets for things like top status bar / bottom dock */
  centerOffsets?: { top?: number; bottom?: number; left?: number; right?: number };
};

type ShelfAlloc = { shelfId: string; shelfName: string; qty: number; shelfRefId?: number | null };

type Item = {
  id: string;                // batchNo
  name: string;
  manufacturingDate: string | null;
  expiryDate: string | null;
  batchNumber: string | null;
  purchasePrice: number;
  sellingPrice: number;
  supplierName: string | null;
  qty: number;               // alias of qtyAvailable
  minQty: number;
  shelves: ShelfAlloc[];
};

type ApiListResponse = { items?: Partial<Item>[]; error?: string };
type ApiItemResponse = { item?: Partial<Item>; error?: string };
type ApiOkResponse = { ok?: boolean; error?: string };

/* Sales (history) */
type SaleLine = { id: string; name: string; price: number; qty: number; lineTotal: number };
type Sale = { _id: string; total: number; lines: SaleLine[]; createdAt: string; createdBy?: string | null };
type ApiSalesList = { items: Sale[]; totalCount: number; page: number; pages: number; error?: string };

/* Extra shapes from API to avoid `any` */
type PartialShelf = Partial<{
  shelfId: string | number | null;
  shelfName: string | null;
  qty: number | string | null;
  quantity: number | string | null;
  onHand: number | string | null;
  shelfRefId: number | null;
}>;

type UnknownItem = Partial<{
  id: string | number;
  name: string;
  manufacturingDate: string | null;
  expiryDate: string | null;
  batchNumber: string | null;
  purchasePrice: number | string | null;
  sellingPrice: number | string | null;
  supplierName: string | null;
  qty: number | string | null;
  minQty: number | string | null;
  qtyAvailable: number | string | null;
  reorderLevel: number | string | null;
  shelves: PartialShelf[];
  mrp: number | string | null;
  costPrice: number | string | null;
}>;

/* ───────────────────────── Utils ───────────────────────── */

const toNum = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const money = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '0.00');
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e ?? 'Unknown error'));
const toDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString() : '-');

function normalize(p?: Partial<Item> | UnknownItem | null): Item {
  const u = (p ?? {}) as UnknownItem;
  const rawShelves = Array.isArray(u.shelves) ? u.shelves : [];

  const shelves: ShelfAlloc[] = rawShelves.map((s): ShelfAlloc => ({
    shelfId: String(s.shelfId ?? ''),
    shelfName: String(s.shelfName ?? ''),
    qty: toNum(s.qty ?? s.quantity ?? s.onHand),
    shelfRefId: typeof s.shelfRefId === 'number' ? s.shelfRefId : null,
  }));

  const qty =
    toNum(u.qty) ||
    toNum(u.qtyAvailable) ||
    shelves.reduce((a, s) => a + toNum(s.qty), 0);

  return {
    id: String(u.id ?? ''),
    name: String(u.name ?? ''),
    manufacturingDate: u.manufacturingDate ?? null,
    expiryDate: u.expiryDate ?? null,
    batchNumber: u.batchNumber ?? null,
    purchasePrice: toNum(u.purchasePrice ?? u.costPrice),
    sellingPrice: toNum(u.sellingPrice ?? u.mrp),
    supplierName: u.supplierName ?? null,
    qty,
    minQty: toNum(u.minQty ?? u.reorderLevel ?? 0),
    shelves,
  };
}

function useDebounce<T>(v: T, delay = 350) {
  const [s, setS] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setS(v), delay);
    return () => clearTimeout(t);
  }, [v, delay]);
  return s;
}

/* Barcode Detector typing to avoid `any` */
type BarcodeDetection = { rawValue?: string };
type BarcodeDetectorInstance = { detect(video: HTMLVideoElement): Promise<BarcodeDetection[]> };
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorInstance;

/* ───────────────────────── Component ───────────────────────── */

export default function SellMedicineWindow({
  open,
  zIndex = 130,
  onClose,
  onMinimize,
  initialSection = 'sell',
  centerOnOpen = true,
  centerOffsets = { top: 48, bottom: 80, left: 0, right: 0 }, // adjust if your bars are taller/shorter
}: SellMedicineWindowProps) {
  /* viewport + window */
  const [viewport, setViewport] = useState({ w: 1024, h: 768 });
  useEffect(() => {
    const read = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);
  const mobile = viewport.w < 480;

  const MIN_W = 640;
  const MIN_H = 460;
  const DEF_W = Math.min(760, viewport.w - 48);
  const DEF_H = Math.min(520, viewport.h - 48);

  const center = useCallback(
    (w: number, h: number) => {
      const top = centerOffsets.top ?? 0;
      const bottom = centerOffsets.bottom ?? 0;
      const left = centerOffsets.left ?? 0;
      const right = centerOffsets.right ?? 0;

      const availW = Math.max(0, viewport.w - left - right);
      const availH = Math.max(0, viewport.h - top - bottom);

      return {
        x: Math.max(12 + left, Math.round(left + (availW - w) / 2)),
        y: Math.max(12 + top, Math.round(top + (availH - h) / 2)),
      };
    },
    [viewport.w, viewport.h, centerOffsets.bottom, centerOffsets.left, centerOffsets.right, centerOffsets.top]
  );

  const [size, setSize] = useState<{ w: number; h: number }>({ w: DEF_W, h: DEF_H });
  const [pos, setPos] = useState<{ x: number; y: number }>(center(DEF_W, DEF_H));
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (centerOnOpen && !maximized) {
      const w = Math.min(760, viewport.w - 48);
      const h = Math.min(520, viewport.h - 48);
      setSize({ w: Math.max(w, MIN_W), h: Math.max(h, MIN_H) });
      // next frame so Rnd applies cleanly
      requestAnimationFrame(() => setPos(center(w, h)));
    }
  }, [open, centerOnOpen, viewport.w, viewport.h, maximized, center]);

  /* state */
  const [section, setSection] = useState<Section>(initialSection);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const dq = useDebounce(q);

  const fetchItems = React.useCallback(async () => {
    setMsg(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory?q=${encodeURIComponent(dq)}`, { credentials: 'include' });
      const data = (await res.json()) as ApiListResponse;
      if (!res.ok) throw new Error(data?.error ?? 'Failed to load');
      const normalized = (data.items ?? []).map(normalize);
      setItems(normalized);
      if (normalized.length === 0) setMsg('No results found.');
    } catch (e: unknown) {
      setMsg(errMsg(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [dq]);

  useEffect(() => {
    if (section === 'sell') fetchItems();
  }, [section, dq, fetchItems]);

  /* cart */
  type CartLine = {
    id: string;       // batchNo
    name: string;
    price: number;
    available: number;
    qty: number;
    shelves: ShelfAlloc[];
  };
  const [cart, setCart] = useState<CartLine[]>([]);
  const cartTotal = useMemo(() => cart.reduce((a, c) => a + c.price * c.qty, 0), [cart]);

  type Notice = { kind: 'success' | 'info' | 'error'; text: string };
  const [notice, setNotice] = useState<Notice | null>(null);
  function showNotice(n: Notice | null) {
    setNotice(n);
    if (n) window.setTimeout(() => setNotice((p) => (p && p.text === n.text ? null : p)), 3500);
  }

  function addToCart(it: Item) {
    if (!it.id) return;
    setCart((prev) =>
      prev.some((l) => l.id === it.id)
        ? prev
        : [
            ...prev,
            {
              id: it.id,
              name: it.name,
              price: it.sellingPrice || 0,
              available: it.qty || 0,
              qty: it.qty > 0 ? 1 : 0,
              shelves: it.shelves || [],
            },
          ]
    );
    showNotice({ kind: 'info', text: `Added “${it.name}” to cart.` });
  }
  const setLineQty = (id: string, qty: number) =>
    setCart((prev) => prev.map((l) => (l.id === id ? { ...l, qty: Math.max(0, Math.min(qty, l.available)) } : l)));
  const removeLine = (id: string) => {
    const removed = cart.find((c) => c.id === id);
    setCart((prev) => prev.filter((l) => l.id !== id));
    if (removed) showNotice({ kind: 'info', text: `Removed “${removed.name}” from cart.` });
  };
  const clearCart = () => {
    setCart([]);
    showNotice({ kind: 'info', text: 'Cart cleared.' });
  };

  /* sell */
  const [selling, setSelling] = useState(false);
  const [sellMsg, setSellMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function subtractShelves(original: ShelfAlloc[], sellQty: number): ShelfAlloc[] | null {
    let remaining = sellQty;
    const result: ShelfAlloc[] = original.map((s) => ({ ...s }));
    for (let i = 0; i < result.length && remaining > 0; i++) {
      const available = Math.max(0, toNum(result[i].qty));
      const take = Math.min(available, remaining);
      result[i].qty = available - take;
      remaining -= take;
    }
    if (remaining > 0) return null;
    return result.filter((r) => r.qty > 0);
  }

  async function completeSale() {
    setSellMsg(null);
    if (cart.length === 0) {
      const t = 'Cart is empty.';
      setSellMsg({ kind: 'err', text: t });
      showNotice({ kind: 'error', text: t });
      return;
    }
    for (const line of cart) {
      if (line.qty <= 0) {
        const t = `Quantity must be > 0 for ${line.name}.`;
        setSellMsg({ kind: 'err', text: t });
        showNotice({ kind: 'error', text: t });
        return;
      }
      if (line.qty > line.available) {
        const t = `Not enough stock for ${line.name}. Available: ${line.available}`;
        setSellMsg({ kind: 'err', text: t });
        showNotice({ kind: 'error', text: t });
        return;
      }
    }

    setSelling(true);
    try {
      // 1) Update inventory batches
      for (const line of cart) {
        const newShelves = subtractShelves(line.shelves, line.qty);
        if (!newShelves) throw new Error(`Shelves do not have enough stock for ${line.name}.`);
        const newQty = line.available - line.qty;

        const res = await fetch('/api/inventory', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            id: line.id,
            qty: newQty,
            shelves: newShelves.map((s) => ({
              shelfId: s.shelfId,
              shelfName: s.shelfName,
              qty: s.qty,
              shelfRefId: s.shelfRefId ?? undefined,
            })),
          }),
        });

        const data = (await res.json()) as ApiOkResponse & ApiItemResponse;
        const success = res.ok && (('item' in data && !!data.item) || data.ok === true);
        const maybeErr = 'error' in data ? data.error : undefined;
        if (!success) throw new Error(maybeErr ?? 'Failed to update inventory');
      }

      // 2) Save the sale
      const lines: SaleLine[] = cart.map((l) => ({
        id: l.id,
        name: l.name,
        price: l.price,
        qty: l.qty,
        lineTotal: l.qty * l.price,
      }));
      const total = lines.reduce((a, x) => a + x.lineTotal, 0);

      const r2 = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ total, lines }),
      });
      const d2 = (await r2.json()) as ApiOkResponse;
      if (!r2.ok || d2?.ok !== true) throw new Error(d2?.error ?? 'Failed to save sale');

      setSellMsg({ kind: 'ok', text: 'Sale completed.' });
      showNotice({ kind: 'success', text: 'Sale completed and recorded.' });
      clearCart();
      fetchItems();
      if (section === 'history') await fetchHistory(1);
    } catch (e: unknown) {
      const t = errMsg(e);
      setSellMsg({ kind: 'err', text: t });
      showNotice({ kind: 'error', text: t });
    } finally {
      setSelling(false);
    }
  }

  /* Scanner */
  const [scanOpen, setScanOpen] = useState(false);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null);

  useEffect(() => {
    if (!scanOpen) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    const localVideo = videoRef.current; // capture stable ref for cleanup

    async function init() {
      setScanErr(null);
      const BD = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      if (!BD) {
        setScanErr('BarcodeDetector not supported. Type in the search box or use a different browser.');
        return;
      }
      try {
        detectorRef.current = new BD({ formats: ['qr_code', 'ean_13', 'code_128', 'upc_a'] });
      } catch {
        setScanErr('BarcodeDetector initialization failed.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();

        const tick = async () => {
    const vid = localVideo;
          const det = detectorRef.current;
          if (!vid || !det || stopped) return;
          try {
            const codes = await det.detect(vid);
            if (codes && codes.length) {
              const raw = String(codes[0]?.rawValue || '').trim();
              if (raw) {
                setQ(raw);
                setScanOpen(false);
                return;
              }
            }
          } catch {
            /* noop */
          }
          frameRef.current = requestAnimationFrame(tick);
        };
        frameRef.current = requestAnimationFrame(tick);
      } catch (e: unknown) {
        setScanErr(errMsg(e));
      }
    }

    init();

    return () => {
      stopped = true;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      if (localVideo) {
        try { localVideo.pause(); } catch { /* noop */ }
        const src = localVideo.srcObject;
        if (src && typeof (src as MediaStream).getTracks === 'function') {
          (src as MediaStream).getTracks().forEach((t) => t.stop());
        }
        localVideo.srcObject = null;
      }
    };
  }, [scanOpen]);

  /* History */
  const [hQ, setHQ] = useState('');
  const dHQ = useDebounce(hQ, 350);
  const [hLoading, setHLoading] = useState(false);
  const [hMsg, setHMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<Sale[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [openSale, setOpenSale] = useState<Sale | null>(null);

  const fetchHistory = React.useCallback(async (p = 1) => {
    setHMsg(null);
    setHLoading(true);
    try {
      const res = await fetch(`/api/sales?q=${encodeURIComponent(dHQ)}&page=${p}&limit=20`, { credentials: 'include' });
      const data = (await res.json()) as ApiSalesList;
      if (!res.ok) throw new Error(data?.error ?? 'Failed to load sales history');
      setHistory(data.items || []);
      setPages(data.pages || 1);
      setPage(data.page || 1);
      if (!data.items?.length) setHMsg('No sales found.');
    } catch (e: unknown) {
      setHMsg(errMsg(e));
      setHistory([]);
    } finally {
      setHLoading(false);
    }
  }, [dHQ]);

  useEffect(() => {
    if (section === 'history') fetchHistory(1);
  }, [section, dHQ, fetchHistory]);

  /* ───────────────────── Early return AFTER hooks ───────────────────── */
  if (!open) return null;

  /* ───────────────────────── Mobile ───────────────────────── */

  const DRAG_HANDLE = 'mac-titlebar';
  const DRAG_CANCEL = '.window-content, .window-content *';

  if (mobile) {
    return (
      <div className="fixed inset-0 z-[140] flex flex-col bg-black/60">
        <div className="h-8 flex items-center justify-center text-white/80 text-xs">Sell</div>
        <div className="flex-1 rounded-t-2xl bg-white/85 backdrop-blur-xl overflow-hidden border-t border-white/30">
          {/* top bar */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/40 bg-white/60">
            <div className="text-sm font-medium text-slate-800 capitalize">{section}</div>
            <button onClick={onClose} className="rounded px-2 py-1 bg-white/70 border border-white/40 text-xs">
              <X className="h-4 w-4 inline -mt-0.5 mr-1" /> Close
            </button>
          </div>

          {/* notice */}
          {notice && (
            <div
              className={`mx-3 mt-2 mb-0 rounded-md px-3 py-2 text-sm ${
                notice.kind === 'success'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : notice.kind === 'error'
                  ? 'bg-rose-50 text-rose-700 border border-rose-200'
                  : 'bg-slate-50 text-slate-700 border border-slate-200'
              }`}
            >
              {notice.text}
            </div>
          )}

          {/* content */}
          <div className="window-content h-[calc(100%-48px-52px)] overflow-y-auto p-3">
            {section === 'sell' && (
              <>
                {/* search / actions */}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Search by name, ID, or batch…"
                      className="pl-8 h-10 w-full"
                    />
                  </div>
                  <Button variant="outline" className="h-10" onClick={fetchItems}>
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  </Button>
                  <Button className="h-10" onClick={() => setScanOpen(true)}>
                    <QrCode className="h-4 w-4 mr-1" /> Scan
                  </Button>
                </div>

                {/* list as compact cards (mobile) */}
                <div className="mt-3 space-y-3">
                  {items.length === 0 ? (
                    <div className="p-3 text-sm text-slate-600 rounded-xl border border-white/40 bg-white/70">
                      {msg || 'No results'}
                    </div>
                  ) : (
                    items.map((it) => (
                      <div key={it.id} className="p-3 rounded-xl border border-white/40 bg-white/70">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="text-sm font-medium">{it.name}</div>
                            <div className="text-xs text-slate-600 mt-0.5">
                              ID: {it.id} • Price: {money(it.sellingPrice)} • Exp: {toDate(it.expiryDate)}
                            </div>
                            {it.supplierName && (
                              <div className="text-xs text-slate-600 mt-0.5">Supplier: {it.supplierName}</div>
                            )}
                          </div>
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full ${
                              it.qty > it.minQty
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : it.qty > 0
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                            }`}
                          >
                            {it.qty} in stock
                          </span>
                        </div>
                        <Button size="sm" className="w-full mt-2" onClick={() => addToCart(it)} disabled={it.qty <= 0}>
                          Add to cart
                        </Button>
                      </div>
                    ))
                  )}
                </div>

                {/* cart (mobile) */}
                <Card className="mt-4 bg-white/70 border-white/40">
                  <CardHeader className="py-3">
                    <CardTitle className="text-base">Cart</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3">
                    {cart.length === 0 ? (
                      <div className="text-sm text-slate-600">Cart is empty</div>
                    ) : (
                      <div className="space-y-3">
                        {cart.map((l) => (
                          <div key={l.id} className="flex items-center gap-2">
                            <div className="flex-1">
                              <div className="text-sm font-medium">{l.name}</div>
                              <div className="text-xs text-slate-600">ID: {l.id} • In stock: {l.available}</div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setLineQty(l.id, l.qty - 1)}>
                                <Minus className="h-4 w-4" />
                              </Button>
                              <Input
                                value={String(l.qty)}
                                onChange={(e) => setLineQty(l.id, toNum(e.target.value))}
                                className="h-8 w-16 text-center"
                                inputMode="numeric"
                              />
                              <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setLineQty(l.id, l.qty + 1)}>
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                            <div className="w-20 text-right text-sm font-medium">{money(l.qty * l.price)}</div>
                            <Button size="icon" variant="destructive" className="h-8 w-8" onClick={() => removeLine(l.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                        <div className="pt-2 border-t border-white/40 flex items-center justify-between">
                          <div className="text-sm">Total</div>
                          <div className="text-base font-semibold">{money(cartTotal)}</div>
                        </div>
                        {sellMsg && (
                          <div className={`text-sm ${sellMsg.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {sellMsg.text}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <Button variant="secondary" onClick={clearCart} disabled={selling}>
                            Clear
                          </Button>
                          <Button onClick={completeSale} disabled={selling || cart.length === 0}>
                            <Check className="h-4 w-4 mr-1" /> {selling ? 'Processing…' : 'Complete Sale'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}

            {section === 'history' && (
              <Card className="bg-white/60 backdrop-blur-lg border-white/40">
                <CardHeader className="pb-2 pt-3">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-lg">Sales History</CardTitle>
                    <div className="ml-auto flex gap-2 w-full sm:w-auto">
                      <div className="relative flex-1 sm:w-72">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input value={hQ} onChange={(e) => setHQ(e.target.value)} placeholder="Search by item id/name…" className="pl-8 h-9 w-full" />
                      </div>
                      <Button variant="outline" className="h-9" onClick={() => fetchHistory(page)}>
                        <RefreshCw className={`h-4 w-4 ${hLoading ? 'animate-spin' : ''}`} />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-3">
                  <div className="rounded-lg border border-white/40 bg-white/60 overflow-hidden">
                    <div className="max-h-[48vh] overflow-auto">
                      <table className="min-w-[720px] w-full text-left text-[13px]">
                        <thead className="bg-white/70 sticky top-0 z-10">
                          <tr>
                            <Th>When</Th>
                            <Th>Items</Th>
                            <Th>Total</Th>
                            <Th>By</Th>
                            <Th className="text-right pr-3">Actions</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {history.length === 0 ? (
                            <tr>
                              <td className="px-3 py-3 text-slate-500" colSpan={5}>
                                {hMsg || 'No sales'}
                              </td>
                            </tr>
                          ) : (
                            history.map((s) => (
                              <tr key={s._id} className="odd:bg-white/50">
                                <Td>{new Date(s.createdAt).toLocaleString()}</Td>
                                <Td>
                                  {s.lines.reduce((a, l) => a + l.qty, 0)} ({s.lines.length} SKUs)
                                </Td>
                                <Td className="font-medium">{money(s.total)}</Td>
                                <Td>{s.createdBy ?? '-'}</Td>
                                <Td className="text-right pr-3">
                                  <Button size="sm" className="h-8 px-2" onClick={() => setOpenSale(s)}>
                                    View
                                  </Button>
                                </Td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {pages > 1 && (
                    <div className="mt-3 flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        className="h-8"
                        disabled={page <= 1}
                        onClick={() => {
                          const p = page - 1;
                          setPage(p);
                          fetchHistory(p);
                        }}
                      >
                        Prev
                      </Button>
                      <div className="text-sm">
                        {page} / {pages}
                      </div>
                      <Button
                        variant="outline"
                        className="h-8"
                        disabled={page >= pages}
                        onClick={() => {
                          const p = page + 1;
                          setPage(p);
                          fetchHistory(p);
                        }}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* bottom tabs */}
        <div className="grid grid-cols-2 gap-1 border-t border-white/40 bg-white/70">
          {(['sell', 'history'] as Section[]).map((s) => (
            <button
              key={s}
              onClick={() => setSection(s)}
              className={`py-2 text-xs capitalize ${section === s ? 'font-semibold text-slate-900' : 'text-slate-600'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  /* ───────────────────────── Desktop / Tablet ───────────────────────── */

  return (
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
      onDragStop={(_, d) => setPos({ x: d.x, y: d.y })}
      onResizeStop={(_e, _dir, ref, _delta, newPos) => {
        setSize({ w: ref.offsetWidth, h: ref.offsetHeight });
        setPos({ x: newPos.x, y: newPos.y });
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
        maxWidth: 'calc(100vw - 16px)',
        maxHeight: 'calc(100dvh - 16px)',
        overflow: 'hidden',
      }}
    >
      {/* titlebar */}
      <div className="mac-titlebar flex items-center justify-between px-3 py-2 border-b border-white/25 bg-white/25">
        <div className="flex items-center gap-2">
          <button aria-label="Close" onClick={onClose} className="w-3.5 h-3.5 rounded-full" style={{ background: '#ff5f57' }} />
          <button aria-label="Minimize" onClick={onMinimize} className="w-3.5 h-3.5 rounded-full" style={{ background: '#febc2e' }} />
          <button aria-label="Zoom" onClick={() => setMaximized((v) => !v)} className="w-3.5 h-3.5 rounded-full" style={{ background: '#28c840' }} />
          <span className="ml-2 text-sm/5">Sell</span>
        </div>
        <div />
      </div>

      {/* notice */}
      {notice && (
        <div
          className={`mx-3 mt-3 mb-0 rounded-md px-3 py-2 text-sm ${
            notice.kind === 'success'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : notice.kind === 'error'
              ? 'bg-rose-50 text-rose-700 border border-rose-200'
              : 'bg-slate-50 text-slate-700 border border-slate-200'
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className="window-content flex-1 min-h-0 grid grid-cols-[220px_1fr]">
        {/* left nav */}
        <div className="border-r border-white/25 bg-white/35 p-2">
          {(['sell', 'history'] as Section[]).map((s) => (
            <button
              key={s}
              onClick={() => setSection(s)}
              className={`w-full text-left rounded-lg px-3 py-2 mb-1 text-sm capitalize ${
                section === s ? 'bg-white/80 font-medium' : 'hover:bg-white/60'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* right pane */}
        <div className="min-h-0 p-3 md:p-4 overflow-auto">
          {section === 'sell' && (
            <>
              {/* Find */}
              <Card className="bg-white/60 backdrop-blur-lg border-white/40">
                <CardHeader className="pb-2 pt-3 md:pt-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                    <CardTitle className="text-xl">Find Medicine</CardTitle>

                    <div className="lg:ml-auto w-full">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                          <Input
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Search by name, ID, or batch…"
                            className="pl-8 h-10 w-full"
                          />
                        </div>

                        <Button variant="outline" className="h-10 shrink-0" onClick={fetchItems} disabled={loading} title="Refresh">
                          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        </Button>

                        <Button className="h-10 shrink-0" onClick={() => setScanOpen(true)} title="Scan">
                          <QrCode className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-3 md:p-4">
                  <div className="rounded-lg border border-white/40 bg-white/60 overflow-hidden">
                    {/* CARD GRID */}
                    <div className="p-3 grid gap-3 sm:grid-cols-2">
                      {loading ? (
                        <div className="col-span-full flex items-center justify-center py-8 text-slate-500">
                          <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading…
                        </div>
                      ) : items.length === 0 ? (
                        <div className="col-span-full p-3 text-slate-600">{msg || 'No results'}</div>
                      ) : (
                        items.map((it) => (
                          <div key={it.id} className="rounded-xl border border-white/50 bg-white/70 hover:bg-white/90 transition-colors shadow-sm">
                            <div className="p-4">
                              <div className="flex items-start justify-between">
                                <div className="font-semibold text-slate-900">{it.name || '-'}</div>
                                <span
                                  className={`text-[11px] px-2 py-0.5 rounded-full border ${
                                    it.qty > it.minQty
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                      : it.qty > 0
                                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                                      : 'bg-rose-50 text-rose-700 border-rose-200'
                                  }`}
                                >
                                  {it.qty} in stock
                                </span>
                              </div>

                              <div className="mt-2 space-y-1 text-[13px] text-slate-700">
                                <div>ID: {it.id}</div>
                                <div>Price: {money(it.sellingPrice)}</div>
                                <div>Expiry: {toDate(it.expiryDate)}</div>
                                <div>Supplier: {it.supplierName ?? '-'}</div>
                              </div>

                              <Button size="sm" className="w-full mt-3" onClick={() => addToCart(it)} disabled={it.qty <= 0}>
                                Add to Cart
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Cart */}
              <Card className="mt-4 bg-white/60 backdrop-blur-lg border-white/40">
                <CardHeader className="py-3">
                  <CardTitle className="text-lg">Cart</CardTitle>
                </CardHeader>
                <CardContent className="p-3 md:p-4">
                  {cart.length === 0 ? (
                    <div className="text-sm text-slate-600">Cart is empty</div>
                  ) : (
                    <>
                      <div className="rounded-lg border border-white/40 bg-white/60 overflow-hidden">
                        <div className="max-h-[42vh] overflow-auto">
                          <table className="min-w-[720px] w-full text-left text-[13px]">
                            <thead className="bg-white/70 sticky top-0 z-10">
                              <tr>
                                <Th>ID</Th>
                                <Th>Name</Th>
                                <Th>In Stock</Th>
                                <Th>Price</Th>
                                <Th>Qty</Th>
                                <Th>Line Total</Th>
                                <Th className="text-right pr-3">Remove</Th>
                              </tr>
                            </thead>
                            <tbody>
                              {cart.map((l) => (
                                <tr key={l.id} className="odd:bg-white/50">
                                  <Td>{l.id}</Td>
                                  <Td>{l.name}</Td>
                                  <Td>{l.available}</Td>
                                  <Td>{money(l.price)}</Td>
                                  <Td>
                                    <div className="flex items-center gap-1">
                                      <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setLineQty(l.id, l.qty - 1)}>
                                        <Minus className="h-4 w-4" />
                                      </Button>
                                      <Input
                                        value={String(l.qty)}
                                        onChange={(e) => setLineQty(l.id, toNum(e.target.value))}
                                        className="h-8 w-16 text-center"
                                        inputMode="numeric"
                                      />
                                      <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setLineQty(l.id, l.qty + 1)}>
                                        <Plus className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </Td>
                                  <Td className="font-medium">{money(l.qty * l.price)}</Td>
                                  <Td className="text-right pr-3">
                                    <Button size="icon" variant="destructive" className="h-8 w-8" onClick={() => removeLine(l.id)}>
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </Td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        <div className="text-sm">Total</div>
                        <div className="text-xl font-semibold">{money(cartTotal)}</div>
                      </div>

                      {sellMsg && (
                        <div className={`mt-2 text-sm ${sellMsg.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {sellMsg.text}
                        </div>
                      )}

                      <div className="mt-2 flex gap-2">
                        <Button variant="secondary" onClick={clearCart} disabled={selling}>
                          Clear
                        </Button>
                        <Button onClick={completeSale} disabled={selling || cart.length === 0}>
                          <Check className="h-4 w-4 mr-1" /> {selling ? 'Processing…' : 'Complete Sale'}
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {section === 'history' && (
            <Card className="bg-white/60 backdrop-blur-lg border-white/40">
              <CardHeader className="pb-2 pt-3 md:pt-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  <CardTitle className="text-xl">Sales History</CardTitle>

                  <div className="lg:ml-auto w-full">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input value={hQ} onChange={(e) => setHQ(e.target.value)} placeholder="Search sales…" className="pl-8 h-10 w-full" />
                      </div>

                      <Button variant="outline" className="h-10 shrink-0" onClick={() => fetchHistory(page)} disabled={hLoading} title="Refresh">
                        <RefreshCw className={`h-4 w-4 ${hLoading ? 'animate-spin' : ''}`} />
                      </Button>

                      <Button className="h-10 shrink-0" onClick={() => fetchHistory(1)} title="Reset to page 1">
                        Go
                      </Button>
                    </div>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-3 md:p-4">
                <div className="rounded-lg border border-white/40 bg-white/60 overflow-hidden">
                  <div className="max-h-[48vh] overflow-auto">
                    <table className="min-w-[820px] w-full text-left text-[13px]">
                      <thead className="bg-white/70 sticky top-0 z-10">
                        <tr>
                          <Th>When</Th>
                          <Th>Items</Th>
                          <Th>Total</Th>
                          <Th>By</Th>
                          <Th className="text-right pr-3">Actions</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.length === 0 ? (
                          <tr>
                            <td className="px-3 py-3 text-slate-500" colSpan={5}>
                              {hMsg || 'No sales'}
                            </td>
                          </tr>
                        ) : (
                          history.map((s) => (
                            <tr key={s._id} className="odd:bg-white/50">
                              <Td>{new Date(s.createdAt).toLocaleString()}</Td>
                              <Td>
                                {s.lines.reduce((a, l) => a + l.qty, 0)} ({s.lines.length} SKUs)
                              </Td>
                              <Td className="font-medium">{money(s.total)}</Td>
                              <Td>{s.createdBy ?? '-'}</Td>
                              <Td className="text-right pr-3">
                                <Button size="sm" className="h-8 px-2" onClick={() => setOpenSale(s)}>
                                  View
                                </Button>
                              </Td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {pages > 1 && (
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      className="h-8"
                      disabled={page <= 1}
                      onClick={() => {
                        const p = page - 1;
                        setPage(p);
                        fetchHistory(p);
                      }}
                    >
                      Prev
                    </Button>
                    <div className="text-sm">
                      {page} / {pages}
                    </div>
                    <Button
                      variant="outline"
                      className="h-8"
                      disabled={page >= pages}
                      onClick={() => {
                        const p = page + 1;
                        setPage(p);
                        fetchHistory(p);
                      }}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Scanner overlay (desktop) */}
      {scanOpen && (
        <div className="fixed inset-0 z-[150] bg-black/70 flex items-center justify-center">
          <div className="w-[92vw] max-w-[720px] rounded-xl overflow-hidden bg-white/95 backdrop-blur border border-white/30">
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/40">
              <div className="text-sm font-medium">Scan a code</div>
              <button onClick={() => setScanOpen(false)} className="rounded px-2 py-1 bg-white/70 border border-white/40 text-xs">
                <X className="h-4 w-4 inline -mt-0.5 mr-1" /> Close
              </button>
            </div>
            <div className="p-3">
              {scanErr ? (
                <div className="text-sm text-rose-600">{scanErr}</div>
              ) : (
                <video ref={videoRef} className="w-full rounded-md bg-black/60 aspect-video" />
              )}
              <p className="mt-2 text-xs text-slate-600">
                Tip: We match scanned value to <b>ID / Batch / Name</b>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Sale details modal (desktop) */}
      {openSale && (
        <div className="fixed inset-0 z-[160] bg-black/60 flex items-center justify-center">
          <div className="w-[92vw] max-w-[720px] bg-white/95 backdrop-blur rounded-xl border border-white/40 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/40">
              <div className="text-sm font-medium">Sale — {new Date(openSale.createdAt).toLocaleString()}</div>
              <button onClick={() => setOpenSale(null)} className="rounded px-2 py-1 bg-white/70 border border-white/40 text-xs">
                <X className="h-4 w-4 inline -mt-0.5 mr-1" /> Close
              </button>
            </div>
            <div className="p-4">
              <div className="rounded-lg border border-white/40 bg-white/70 overflow-hidden">
                <table className="min-w-[680px] w-full text-left text-[13px]">
                  <thead className="bg-white/70">
                    <tr>
                      <Th>ID</Th>
                      <Th>Name</Th>
                      <Th>Price</Th>
                      <Th>Qty</Th>
                      <Th>Line Total</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {openSale.lines.map((l, i) => (
                      <tr key={i} className="odd:bg-white/50">
                        <Td>{l.id}</Td>
                        <Td>{l.name}</Td>
                        <Td>{money(l.price)}</Td>
                        <Td>{l.qty}</Td>
                        <Td className="font-medium">{money(l.lineTotal)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 text-right text-base font-semibold">Total: {money(openSale.total)}</div>
            </div>
          </div>
        </div>
      )}
    </Rnd>
  );
}

/* ───────────────────── Small bits ───────────────────── */

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-xs font-semibold text-slate-600 ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
