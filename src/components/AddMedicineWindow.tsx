'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import {
  Plus, Pencil, Trash2, QrCode, Search, RefreshCw,
  ChevronDown, X, HardDrive, Gauge,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* ───────────────────────────────── Types ──────────────────────────────── */

type Section = 'add' | 'update' | 'delete' | 'all' | 'shelves';

export type AddMedicineWindowProps = {
  open: boolean;
  zIndex?: number;
  onClose?: () => void;
  onMinimize?: () => void;
  initialSection?: Section;
};

type ShelfAlloc = {
  shelfId: string;
  shelfName: string;
  qty: number;
  shelfRefId?: number | null;
};

type Item = {
  id: string;
  name: string;
  manufacturingDate: string | null;
  expiryDate: string | null;
  batchNumber: string | null;
  purchasePrice: number;
  sellingPrice: number;
  supplierName: string | null;
  qty: number;
  minQty: number;
  shelves: ShelfAlloc[];
};

type ApiListResponse = { items?: Partial<Item>[]; error?: string };
type ApiItemResponse = { item?: Partial<Item>; error?: string };
type ApiOkResponse = { ok?: boolean; error?: string };

type ShelfInfo = {
  id: number;
  name: string;
  capacity: number;
  usedCapacity: number;
  code?: string | null;
  location?: string | null;
  isActive?: boolean;
};

type InventoryUpsertBody = {
  id: string;
  name: string;
  manufacturingDate: string | null;
  expiryDate: string | null;
  batchNumber: string | null;
  purchasePrice: number;
  sellingPrice: number;
  supplierName: string | null;

  // quantity aliases (server-side compatibility)
  qty: number;
  quantity: number;
  stock: number;
  onHand: number;
  totalQty: number;

  // min qty aliases (server-side compatibility)
  minQty: number;
  min_quantity: number;
  reorderLevel: number;
  reorder_level: number;

  shelves: ShelfAlloc[];

  // optional “details/facts”
  facts?: {
    slips_count: number | null;
    tablets_per_slip: number | null;
    total_tablets: number | null;
    mrp_amount: number | null;
    mrp_currency: string | null;
    mrp_text: string | null;
    inferred_uses: string[];
    care_notes: string[];
    side_effects_common: string[];
    avoid_if: string[];
    precautions: string[];
    interactions_key: string[];
  };
};

/* ───────────────────────────────── Helpers ───────────────────────────── */

const toNum = (v: unknown): number =>
  v == null || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v);

const fmtMoneyInput = (v: string): string => v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');

const toDateInput = (v?: string | null): string => (v ? v.slice(0, 10) : '');

const fromDateInput = (v?: string): string | null => (v ? v : null);

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e ?? 'Unknown error'));

function useDebounce<T>(v: T, delay = 300): T {
  const [s, setS] = useState<T>(v);
  useEffect(() => {
    const t = setTimeout(() => setS(v), delay);
    return () => clearTimeout(t);
  }, [v, delay]);
  return s;
}

function fmtFriendly(v?: string | null) {
  const d = v ? new Date(v) : null;
  return d ? d.toLocaleDateString() : '-';
}

function hasKey<T extends object, K extends PropertyKey>(
  obj: T,
  key: K
): obj is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function normalize(p?: Partial<Item> | null): Item {
  const base: Record<string, unknown> = (p ?? {}) as Record<string, unknown>;
  const shelvesRaw = Array.isArray(base.shelves) ? (base.shelves as unknown[]) : [];

  const shelves: ShelfAlloc[] = shelvesRaw
    .map((s) => {
      const row = (s ?? {}) as Record<string, unknown>;
      const shelfId = String((row.shelfId ?? '') as string);
      const shelfName = String((row.shelfName ?? '') as string);
      const qty =
        toNum(
          hasKey(row, 'qty')
            ? row.qty
            : hasKey(row, 'quantity')
            ? row.quantity
            : hasKey(row, 'stock')
            ? row.stock
            : hasKey(row, 'onHand')
            ? row.onHand
            : 0
        ) || 0;
      const shelfRefId =
        typeof row.shelfRefId === 'number'
          ? (row.shelfRefId as number)
          : null;

      return { shelfId, shelfName, qty, shelfRefId };
    })
    .filter((r) => r.shelfId || r.shelfName);

  const qtyCandidates: unknown[] = [
    base.qty,
    base.quantity,
    base.stock,
    base.onHand,
    base.totalQty,
    shelves.reduce<unknown>(
      (a, s) => toNum(a) + toNum(s.qty),
      0
    ),
  ];

  const minQtyCandidates: unknown[] = [
    base.minQty,
    base.min_quantity,
    base.reorderLevel,
    base.reorder_level,
  ];

  const firstFinite = (arr: unknown[]): number => {
    for (const v of arr) {
      const n = toNum(v);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return 0;
  };

  return {
    id: String((base.id ?? '') as string),
    name: String((base.name ?? '') as string),
    manufacturingDate:
      typeof base.manufacturingDate === 'string'
        ? base.manufacturingDate
        : hasKey(base, 'manufacturedAt') && typeof base.manufacturedAt === 'string'
        ? (base.manufacturedAt as string)
        : null,
    expiryDate:
      typeof base.expiryDate === 'string'
        ? base.expiryDate
        : hasKey(base, 'expiresAt') && typeof base.expiresAt === 'string'
        ? (base.expiresAt as string)
        : null,
    batchNumber:
      typeof base.batchNumber === 'string'
        ? base.batchNumber
        : hasKey(base, 'batch_no') && typeof base.batch_no === 'string'
        ? (base.batch_no as string)
        : null,
    purchasePrice: toNum(hasKey(base, 'purchasePrice') ? base.purchasePrice : base.buyPrice),
    sellingPrice: toNum(hasKey(base, 'sellingPrice') ? base.sellingPrice : base.sellPrice),
    supplierName:
      typeof base.supplierName === 'string'
        ? base.supplierName
        : hasKey(base, 'supplier') && typeof base.supplier === 'string'
        ? (base.supplier as string)
        : null,
    qty: firstFinite(qtyCandidates),
    minQty: firstFinite(minQtyCandidates),
    shelves,
  };
}

function cryptoRandom() {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

/* ───────────────────── First-time setup modal ────────────────────────── */

function FirstTimeSetupModal({ onComplete }: { onComplete: (shelves: ShelfInfo[]) => void }) {
  const [numShelves, setNumShelves] = useState(3);
  const [avgCapacity, setAvgCapacity] = useState(100);
  const [shelfNames, setShelfNames] = useState<string[]>(['Shelf A', 'Shelf B', 'Shelf C']);

  useEffect(() => {
    setShelfNames((prev) => {
      const next = [...prev];
      while (next.length < numShelves) next.push(`Shelf ${next.length + 1}`);
      return next.slice(0, numShelves);
    });
  }, [numShelves]);

  const handleSubmit = () => {
    if (numShelves < 1 || avgCapacity < 1) {
      // eslint-disable-next-line no-alert
      alert('Please enter valid number of shelves and capacity.');
      return;
    }
    const shelves: ShelfInfo[] = shelfNames.map((name, i) => ({
      id: i + 1,
      name: name.trim() || `Shelf ${i + 1}`,
      capacity: avgCapacity,
      usedCapacity: 0,
    }));
    localStorage.setItem('shelvesSetupDone', 'true');
    localStorage.setItem('shelvesData', JSON.stringify(shelves));
    onComplete(shelves);
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center">
      <div className="bg-white/95 backdrop-blur rounded-xl p-5 w-[92vw] max-w-md border border-white/40 shadow-2xl">
        <div className="text-lg font-semibold mb-2">Initial Shelves Setup</div>
        <div className="text-xs text-slate-600 mb-4">Create a few shelves and set their max capacity.</div>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <Label className="text-xs">Number of Shelves</Label>
            <Input
              type="number"
              min={1}
              value={numShelves}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setNumShelves(Math.max(1, Number(e.target.value)))
              }
            />
          </div>
          <div>
            <Label className="text-xs">Average Capacity per Shelf</Label>
            <Input
              type="number"
              min={1}
              value={avgCapacity}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setAvgCapacity(Math.max(1, Number(e.target.value)))
              }
            />
          </div>
          <div>
            <div className="text-xs font-medium mb-1">Shelf Names (optional)</div>
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {shelfNames.map((n, i) => (
                <Input
                  key={i}
                  value={n}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const next = [...shelfNames];
                    next[i] = e.target.value;
                    setShelfNames(next);
                  }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSubmit}>Save Shelves</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────── Component ─────────────────────────── */

export default function AddMedicineWindow({
  open,
  zIndex = 130,
  onClose,
  onMinimize,
  initialSection = 'add',
}: AddMedicineWindowProps) {
  /* NOTE: We keep hooks at top-level always (no early returns) to satisfy rules-of-hooks. */
  /* viewport + window sizing (smaller, centered) */
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
  const defaultW = Math.min(760, viewport.w - 48);
  const defaultH = Math.min(520, viewport.h - 48);
  const defaultX = Math.max(12, Math.round((viewport.w - defaultW) / 2));
  const defaultY = Math.max(12, Math.round((viewport.h - defaultH) / 2));
  const [pos, setPos] = useState({ x: defaultX, y: defaultY });
  const [size, setSize] = useState({ w: defaultW, h: defaultH });
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (maximized || mobile) return;
    const w = Math.min(760, viewport.w - 48);
    const h = Math.min(520, viewport.h - 48);
    const x = Math.max(12, Math.round((viewport.w - w) / 2));
    const y = Math.max(12, Math.round((viewport.h - h) / 2));
    setPos({ x, y });
    setSize({ w, h });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport.w, viewport.h, maximized, mobile]);

  /* sections / list */
  const [section, setSection] = useState<Section>(initialSection);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [listMsg, setListMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 300);

  async function fetchItems(): Promise<void> {
    setListMsg(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory?q=${encodeURIComponent(dq)}`, { credentials: 'include' });
      const data = (await res.json()) as ApiListResponse;
      if (!res.ok) throw new Error(data?.error ?? 'Failed to load');
      setItems((data.items ?? []).map(normalize));
    } catch (e: unknown) {
      setListMsg({ kind: 'err', text: errMsg(e) });
      setItems([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (open && (section === 'all' || section === 'update' || section === 'delete')) {
      void fetchItems();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, dq, open]);

  /* ─────────────── Local shelves (name + max capacity) ─────────────── */

  const [showSetupModal, setShowSetupModal] = useState(false);
  const [shelves, setShelves] = useState<ShelfInfo[]>([]);
  useEffect(() => {
    const done = localStorage.getItem('shelvesSetupDone');
    const dataStr = localStorage.getItem('shelvesData');
    if (!done || !dataStr) {
      setShowSetupModal(true);
    } else {
      try {
        const parsed = JSON.parse(dataStr) as unknown;
        setShelves(Array.isArray(parsed) ? (parsed as ShelfInfo[]) : []);
      } catch {
        setShowSetupModal(true);
      }
    }
  }, []);
  const persistShelves = (next: ShelfInfo[]) => {
    setShelves(next);
    localStorage.setItem('shelvesSetupDone', 'true');
    localStorage.setItem('shelvesData', JSON.stringify(next));
  };
  const handleSetupComplete = (newShelves: ShelfInfo[]) => {
    persistShelves(newShelves);
    setShowSetupModal(false);
  };
  function addShelfInline(name: string, capacity: number) {
    const next: ShelfInfo[] = [
      ...shelves,
      {
        id: shelves.length ? Math.max(...shelves.map((s) => s.id)) + 1 : 1,
        name: name.trim(),
        capacity: Math.max(1, capacity),
        usedCapacity: 0,
      },
    ];
    persistShelves(next);
  }
  function deleteShelfInline(id: number) {
    persistShelves(shelves.filter((s) => s.id !== id));
  }
  function updateShelfInline(id: number, patch: Partial<ShelfInfo>) {
    persistShelves(shelves.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  /* ─────────────── ADD form (with Details back) ─────────────── */

  const [medName, setMedName] = useState('');
  const [medId, setMedId] = useState('');
  const [mfgDate, setMfgDate] = useState('');
  const [expDate, setExpDate] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [qty, setQty] = useState(''); // keep as string for inputs; cast with toNum on submit
  const [minQty, setMinQty] = useState('');

  // Details (restored)
  const [slipsCount, setSlipsCount] = useState('');
  const [tabsPerSlip, setTabsPerSlip] = useState('');
  const [totalTabs, setTotalTabs] = useState('');
  const [mrpAmount, setMrpAmount] = useState('');
  const [mrpCurrency, setMrpCurrency] = useState('Rs.');
  const [mrpText, setMrpText] = useState('');
  const [uses, setUses] = useState('');
  const [care, setCare] = useState('');
  const [effects, setEffects] = useState('');
  const [avoid, setAvoid] = useState('');
  const [precautions, setPrecautions] = useState('');
  const [interactions, setInteractions] = useState('');
  const [showDetails, setShowDetails] = useState(false);

  const [selectedShelfId, setSelectedShelfId] = useState<number | ''>('');
  const selectedShelf = useMemo(
    () => shelves.find((s) => s.id === selectedShelfId) || null,
    [shelves, selectedShelfId]
  );
  const freeOnSelected = selectedShelf ? selectedShelf.capacity - selectedShelf.usedCapacity : 0;
  const totalQ = toNum(qty);
  const exceedsCapacity = !!selectedShelf && totalQ > freeOnSelected;

  const [addMsg, setAddMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [adding, setAdding] = useState(false);

  async function submitAdd(): Promise<void> {
    setAddMsg(null);

    if (!medId.trim() || !medName.trim()) {
      setAddMsg({ kind: 'err', text: 'ID and Name are required.' });
      return;
    }
    if (totalQ <= 0) {
      setAddMsg({ kind: 'err', text: 'Total quantity must be greater than zero.' });
      return;
    }
    if (!selectedShelf) {
      setAddMsg({ kind: 'err', text: 'Please select a shelf.' });
      return;
    }
    if (totalQ > freeOnSelected) {
      setAddMsg({ kind: 'err', text: 'Not enough capacity on the selected shelf.' });
      return;
    }

    // One allocation row; keep qty consistent with shelves
    const allocQty = totalQ;
    const allocs: ShelfAlloc[] = [
      {
        shelfId: String(selectedShelf.id),
        shelfName: selectedShelf.name,
        qty: allocQty,
        shelfRefId: undefined,
      },
    ];

    setAdding(true);
    try {
      const body: InventoryUpsertBody = {
        id: medId.trim(),
        name: medName.trim(),
        manufacturingDate: fromDateInput(mfgDate),
        expiryDate: fromDateInput(expDate),
        batchNumber: batchNumber || null,
        purchasePrice: toNum(purchasePrice),
        sellingPrice: toNum(sellingPrice),
        supplierName: supplierName || null,

        qty: totalQ,
        quantity: totalQ,
        stock: totalQ,
        onHand: totalQ,
        totalQty: totalQ,

        minQty: toNum(minQty),
        min_quantity: toNum(minQty),
        reorderLevel: toNum(minQty),
        reorder_level: toNum(minQty),

        shelves: allocs,

        facts: {
          slips_count: slipsCount ? Number(slipsCount) : null,
          tablets_per_slip: tabsPerSlip ? Number(tabsPerSlip) : null,
          total_tablets: totalTabs ? Number(totalTabs) : null,
          mrp_amount: mrpAmount ? Number(mrpAmount) : null,
          mrp_currency: mrpCurrency || null,
          mrp_text: mrpText || null,
          inferred_uses: splitList(uses),
          care_notes: splitList(care),
          side_effects_common: splitList(effects),
          avoid_if: splitList(avoid),
          precautions: splitList(precautions),
          interactions_key: splitList(interactions),
        },
      };

      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as ApiItemResponse;
      if (!res.ok) throw new Error(data?.error ?? 'Create failed');

      // On success: update local shelf usedCapacity
      const nextShelves = shelves.map((s) =>
        s.id === selectedShelf.id ? { ...s, usedCapacity: s.usedCapacity + allocQty } : s
      );
      persistShelves(nextShelves);

      setAddMsg({ kind: 'ok', text: 'Added successfully.' });
      resetAddForm();
      void fetchItems();
    } catch (e: unknown) {
      setAddMsg({ kind: 'err', text: errMsg(e) });
    } finally {
      setAdding(false);
    }
  }

  function resetAddForm(): void {
    setMedId('');
    setMedName('');
    setMfgDate('');
    setExpDate('');
    setBatchNumber('');
    setPurchasePrice('');
    setSellingPrice('');
    setSupplierName('');
    setQty('');
    setMinQty('');
    setAddMsg(null);
    setSelectedShelfId('');
    setSlipsCount('');
    setTabsPerSlip('');
    setTotalTabs('');
    setMrpAmount('');
    setMrpText('');
    setUses('');
    setCare('');
    setEffects('');
    setAvoid('');
    setPrecautions('');
    setInteractions('');
  }

  /* update/delete */
  const [edit, setEdit] = useState<Item | null>(null);
  const [eId, setEId] = useState('');
  const [eName, setEName] = useState('');
  const [eMfg, setEMfg] = useState('');
  const [eExp, setEExp] = useState('');
  const [eBatch, setEBatch] = useState('');
  const [eBuy, setEBuy] = useState('');
  const [eSell, setESell] = useState('');
  const [eSupplier, setESupplier] = useState('');
  const [eQty, setEQty] = useState('');
  const [eMinQty, setEMinQty] = useState('');
  const [eShelves, setEShelves] = useState<ShelfAlloc[]>([]);
  const [uMsg, setUMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [updating, setUpdating] = useState(false);

  function startEdit(it: Item): void {
    setEdit(it);
    setEId(it.id);
    setEName(it.name);
    setEMfg(toDateInput(it.manufacturingDate));
    setEExp(toDateInput(it.expiryDate));
    setEBatch(it.batchNumber ?? '');
    setEBuy(String(it.purchasePrice || ''));
    setESell(String(it.sellingPrice || ''));
    setESupplier(it.supplierName ?? '');
    setEQty(String(it.qty || ''));
    setEMinQty(String(it.minQty || ''));
    setEShelves(it.shelves.length ? it.shelves.map((s) => ({ ...s })) : []);
  }
  function cancelEdit(): void {
    setEdit(null);
    setUMsg(null);
  }

  async function saveEdit(): Promise<void> {
    if (!eId) {
      setUMsg({ kind: 'err', text: 'Invalid item' });
      return;
    }
    setUMsg(null);
    setUpdating(true);
    try {
      const total = toNum(eQty);
      const min = toNum(eMinQty);

      const payload: InventoryUpsertBody = {
        id: eId,
        name: eName.trim(),
        manufacturingDate: fromDateInput(eMfg),
        expiryDate: fromDateInput(eExp),
        batchNumber: eBatch || null,
        purchasePrice: toNum(eBuy),
        sellingPrice: toNum(eSell),
        supplierName: eSupplier || null,

        qty: total,
        quantity: total,
        stock: total,
        onHand: total,
        totalQty: total,

        minQty: min,
        min_quantity: min,
        reorderLevel: min,
        reorder_level: min,

        shelves: eShelves.map((s) => ({
          shelfId: s.shelfId,
          shelfName: s.shelfName.trim(),
          qty: toNum(s.qty),
          shelfRefId: s.shelfRefId ?? undefined,
        })),
      };

      const res = await fetch('/api/inventory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as ApiOkResponse;
      if (!res.ok || data.ok !== true) throw new Error(data?.error ?? 'Update failed');

      setItems((prev) =>
        prev.map((x) =>
          x.id === eId
            ? normalize({
                id: eId,
                name: eName,
                manufacturingDate: fromDateInput(eMfg),
                expiryDate: fromDateInput(eExp),
                batchNumber: eBatch || null,
                purchasePrice: toNum(eBuy),
                sellingPrice: toNum(eSell),
                supplierName: eSupplier || null,
                qty: total,
                minQty: min,
                shelves: eShelves,
              })
            : x
        )
      );
      setUMsg({ kind: 'ok', text: 'Updated.' });
      setEdit(null);
    } catch (e: unknown) {
      setUMsg({ kind: 'err', text: errMsg(e) });
    } finally {
      setUpdating(false);
    }
  }

  const [dMsg, setDMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  async function deleteById(id: string): Promise<void> {
    setDMsg(null);
    try {
      const res = await fetch(`/api/inventory?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = (await res.json()) as ApiOkResponse;
      if (!res.ok || data.ok !== true) throw new Error(data?.error ?? 'Delete failed');
      setItems((prev) => prev.filter((i) => i.id !== id));
      setDMsg({ kind: 'ok', text: 'Deleted.' });
    } catch (e: unknown) {
      setDMsg({ kind: 'err', text: errMsg(e) });
    }
  }

  // ─── Scanner state ───────────────────────────────────────────────
const scanInputRef = useRef<HTMLInputElement>(null);
const [scanning, setScanning] = useState(false);
const [scanMsg, setScanMsg] = useState<{ kind: 'ok'|'err'|'info'; text: string } | null>(null);
const [scanPreviews, setScanPreviews] = useState<string[]>([]); // optional thumbnails


// camera modal
const [cameraOpen, setCameraOpen] = useState(false);
const [camStream, setCamStream] = useState<MediaStream | null>(null);
const [camShots, setCamShots] = useState<string[]>([]); // data URLs


async function openCamera() {
  try {
    setScanMsg(null);
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    setCamStream(stream);
    setCamShots([]);
    setCameraOpen(true);
  } catch (e:any) {
    setScanMsg({ kind:'err', text: e?.message || 'Unable to access camera. Try Files instead.' });
  }
}

function closeCamera() {
  camStream?.getTracks().forEach(t => t.stop());
  setCamStream(null);
  setCameraOpen(false);
  setCamShots([]);
}

// capture a frame to dataURL
function captureFromVideo(videoEl: HTMLVideoElement) {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(videoEl, 0, 0, w, h);
  const url = canvas.toDataURL('image/jpeg', 0.9);
  setCamShots(prev => {
    if (prev.length >= MAX_FILES) return prev; // enforce max 20
    return [...prev, url];
  });
}


function applyExtractedToForm(x: any) {
  if (!x) return;
  setMedName(x.name || '');
  setBatchNumber(x.batch_number || '');
  setMfgDate((x.manufacturing_date || '').slice(0, 10));
  setExpDate((x.expiry_date || '').slice(0, 10));
  setSlipsCount(String(x.slips_count ?? ''));
  setTabsPerSlip(String(x.tablets_per_slip ?? ''));
  setMrpAmount(String(x.mrp_amount ?? ''));
  setMrpText(x.mrp_text || '');
  setUses((x.uses_on_label || x.inferred_uses || []).join(', '));
  setCare((x.care_notes || []).join(', '));
  setEffects((x.side_effects_common || []).join(', '));
  setAvoid((x.avoid_if || []).join(', '));
  setPrecautions((x.precautions || []).join(', '));
  setInteractions((x.interactions_key || []).join(', '));
  setShowDetails(true);
}

const ACCEPTED = ['image/jpeg','image/png','image/webp','image/jpg','image/bmp','image/tiff'];
const MAX_FILES = 20;
const MIN_FILES = 2;
const MAX_EACH_MB = 5;

function openScanner() {
  setScanMsg(null);
  scanInputRef.current?.click();
}
async function dataURLToFile(dataURL: string, i: number): Promise<File> {
  const res = await fetch(dataURL);
  const blob = await res.blob();
  return new File([blob], `capture-${i+1}.jpg`, { type: 'image/jpeg' });
}

async function confirmCameraShots() {
  if (camShots.length < MIN_FILES) {
    setScanMsg({ kind:'err', text:`Take at least ${MIN_FILES} photos.` });
    return;
  }
  if (camShots.length > MAX_FILES) {
    setScanMsg({ kind:'err', text:`At most ${MAX_FILES} photos.` });
    return;
  }
  setCameraOpen(false);
  camStream?.getTracks().forEach(t => t.stop());
  setCamStream(null);

  const files: File[] = [];
  for (let i = 0; i < camShots.length; i++) {
    files.push(await dataURLToFile(camShots[i], i));
  }
  await onScanPicked(files);
}

async function onScanPicked(filesIn: FileList | File[] | null) {
  setScanMsg(null);
  if (!filesIn || (Array.isArray(filesIn) ? filesIn.length === 0 : filesIn.length === 0)) return;

  const files = Array.isArray(filesIn) ? filesIn : Array.from(filesIn);
  // Validate count
  if (files.length < MIN_FILES) {
    setScanMsg({ kind: 'err', text: `Pick at least ${MIN_FILES} images.` });
    return;
  }
  if (files.length > MAX_FILES) {
    setScanMsg({ kind: 'err', text: `You can upload at most ${MAX_FILES} images.` });
    return;
  }


  // Validate type/size and make previews
  const list: File[] = [];
  const previews: string[] = [];
  for (const f of Array.from(files)) {
    if (!ACCEPTED.includes(f.type)) {
      setScanMsg({ kind: 'err', text: `Unsupported file type: ${f.type || 'unknown'}` });
      return;
    }
    if (f.size > MAX_EACH_MB * 1024 * 1024) {
      setScanMsg({ kind: 'err', text: `${f.name} is over ${MAX_EACH_MB}MB.` });
      return;
    }
    list.push(f);
    previews.push(URL.createObjectURL(f));
  }
  setScanPreviews(previews);

  // Build FormData
  const fd = new FormData();
  list.forEach((f) => fd.append('images', f));

  // Call API
  setScanning(true);
  try {
    const res = await fetch('/api/scanner', { method: 'POST', body: fd });
    const json = await res.json();

    if (!res.ok) {
      setScanMsg({ kind: 'err', text: json?.error || 'Scan failed' });
      return;
    }

const extracted = json?.data?.extractedData;
const combinedText = json?.data?.combinedText;

if (!extracted || Object.values(extracted).every(v => v == null || v === '' || (Array.isArray(v) && v.length === 0))) {
  setScanMsg({ kind: 'info', text: 'Scan completed but no fields were recognized. Try clearer photos or fill manually.' });
} else {
  applyExtractedToForm(extracted);
  setScanMsg({ kind: 'ok', text: 'Scan complete. Fields populated.' });
}

  } catch (e: any) {
    setScanMsg({ kind: 'err', text: e?.message || 'Scan error' });
  } finally {
    setScanning(false);
  }
}


  /* ─────────────────────────── Mobile full-screen ───────────────────────── */

  const DRAG_HANDLE = 'mac-titlebar';
  const DRAG_CANCEL = '.window-content, .window-content *';

  if (mobile) {
    return (
      <>
        {showSetupModal && <FirstTimeSetupModal onComplete={handleSetupComplete} />}
        <div className="fixed inset-0 z-[140] flex flex-col bg-black/60">
          <div className="h-8 flex items-center justify-center text-white/80 text-xs">Inventory</div>

          <div className="flex-1 rounded-t-2xl bg-white/85 backdrop-blur-xl overflow-hidden border-t border-white/30">
            {/* top bar */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/40 bg-white/60">
              <div className="text-sm font-medium text-slate-800 capitalize">{section}</div>
              <button
                onClick={onClose}
                className="rounded px-2 py-1 bg-white/70 border border-white/40 text-xs"
              >
                <X className="h-4 w-4 inline -mt-0.5 mr-1" /> Close
              </button>
            </div>

            {/* content */}
            <div className="window-content h-[calc(100%-48px-52px)] overflow-y-auto p-3">
              {section === 'shelves' ? (
                <MobileShelvesLocal
                  shelves={shelves}
                  onAdd={(name, cap) => addShelfInline(name, cap)}
                  onDelete={(id) => deleteShelfInline(id)}
                  onUpdate={(id, patch) => updateShelfInline(id, patch)}
                />
              ) : section === 'add' ? (
                <MobileAddSimple
                  medName={medName}
                  setMedName={setMedName}
                  medId={medId}
                  setMedId={setMedId}
                  mfgDate={mfgDate}
                  setMfgDate={setMfgDate}
                  expDate={expDate}
                  setExpDate={setExpDate}
                  batchNumber={batchNumber}
                  setBatchNumber={setBatchNumber}
                  purchasePrice={purchasePrice}
                  setPurchasePrice={setPurchasePrice}
                  sellingPrice={sellingPrice}
                  setSellingPrice={setSellingPrice}
                  supplierName={supplierName}
                  setSupplierName={setSupplierName}
                  qty={qty}
                  setQty={setQty}
                  minQty={minQty}
                  setMinQty={setMinQty}
                  selectedShelfId={selectedShelfId}
                  setSelectedShelfId={setSelectedShelfId}
                  shelves={shelves}
                  freeOnSelected={freeOnSelected}
                  exceedsCapacity={exceedsCapacity}
                  addMsg={addMsg}
                  adding={adding}
                  submitAdd={submitAdd}
                  slipsCount={slipsCount}
                  setSlipsCount={setSlipsCount}
                  tabsPerSlip={tabsPerSlip}
                  setTabsPerSlip={setTabsPerSlip}
                  totalTabs={totalTabs}
                  setTotalTabs={setTotalTabs}
                  mrpAmount={mrpAmount}
                  setMrpAmount={setMrpAmount}
                  mrpCurrency={mrpCurrency}
                  setMrpCurrency={setMrpCurrency}
                  mrpText={mrpText}
                  setMrpText={setMrpText}
                  uses={uses}
                  setUses={setUses}
                  care={care}
                  setCare={setCare}
                  effects={effects}
                  setEffects={setEffects}
                  avoid={avoid}
                  setAvoid={setAvoid}
                  precautions={precautions}
                  setPrecautions={setPrecautions}
                  interactions={interactions}
                  setInteractions={setInteractions}
                  showDetails={showDetails}
                  setShowDetails={setShowDetails}
                  setAddMsg={setAddMsg}
                />
              ) : (
                <MobileListCrud
                  section={section}
                  q={q}
                  setQ={setQ}
                  loading={loading}
                  fetchItems={fetchItems}
                  items={items}
                  startEdit={startEdit}
                  deleteById={deleteById}
                  eId={eId}
                  eName={eName}
                  eMfg={eMfg}
                  eExp={eExp}
                  eBatch={eBatch}
                  eBuy={eBuy}
                  eSell={eSell}
                  eSupplier={eSupplier}
                  eQty={eQty}
                  eMinQty={eMinQty}
                  setEName={setEName}
                  setEMfg={setEMfg}
                  setEExp={setEExp}
                  setEBatch={setEBatch}
                  setEBuy={setEBuy}
                  setESell={setESell}
                  setESupplier={setESupplier}
                  setEQty={setEQty}
                  setEMinQty={setEMinQty}
                  eShelves={eShelves}
                  setEShelves={setEShelves}
                  cancelEdit={cancelEdit}
                  saveEdit={saveEdit}
                  uMsg={uMsg}
                  updating={updating}
                  listMsg={listMsg}
                  dMsg={dMsg}
                />
              )}
            </div>

            {/* bottom tab bar */}
            <div className="grid grid-cols-5 gap-1 border-t border-white/40 bg-white/70">
              {(['add', 'update', 'delete', 'all', 'shelves'] as Section[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setSection(s)}
                  className={`py-2 text-xs capitalize ${
                    section === s ? 'font-semibold text-slate-900' : 'text-slate-600'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </>
    );
  }

  /* ─────────────────────────── Desktop / Tablet ─────────────────────────── */

  return (
    <>
      {showSetupModal && <FirstTimeSetupModal onComplete={handleSetupComplete} />}

      <Rnd
        default={{ x: defaultX, y: defaultY, width: defaultW, height: defaultH }}
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
            <span className="ml-2 text-sm/5">Inventory</span>
          </div>
          <div />
        </div>

        {/* body: left nav + content */}
        <div className="window-content flex-1 min-h-0 grid grid-cols-[200px_1fr]">
          {/* left nav */}
          <div className="border-r border-white/25 bg-white/35 p-2">
            {(['add', 'update', 'delete', 'all', 'shelves'] as Section[]).map((s) => (
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

          {/* content */}
          <div className="overflow-y-auto p-3 md:p-4">
            {/* ADD */}
            {section === 'add' && (
              <Card className="bg-white/60 backdrop-blur-lg border-white/40">
                <CardHeader className="pb-1 pt-3 md:pt-4 flex-row items-center">
                  <CardTitle className="text-xl">Add Medicine</CardTitle>
                  
<div className="ml-auto flex gap-2">
  <Button
    variant="outline"
    className="h-8 px-3 text-xs"
    onClick={openCamera}
    disabled={scanning}
    title="Use camera"
  >
    <QrCode className="h-4 w-4 mr-1.5" />
    Camera
  </Button>

  <Button
    variant="outline"
    className="h-8 px-3 text-xs"
    onClick={() => { setScanMsg(null); scanInputRef.current?.click(); }}
    disabled={scanning}
    title="Choose from files"
  >
    Files
  </Button>

  <input
    ref={scanInputRef}
    type="file"
    accept="image/*"
    multiple
    hidden
    onChange={(e) => onScanPicked(e.target.files)}
  />
</div>


                  
                </CardHeader>
                <CardContent className="space-y-4 p-3 md:p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Field label="Name">
                      <Input
                        value={medName}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setMedName(e.target.value)
                        }
                        className="h-9"
                        placeholder="Paracetamol 500mg"
                      />
                    </Field>
                    <Field label="ID">
                      <Input
                        value={medId}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setMedId(e.target.value)
                        }
                        className="h-9"
                        placeholder="MED-00123"
                      />
                    </Field>
                    <Field label="Manufacturing Date">
                      <Input
                        type="date"
                        value={mfgDate}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setMfgDate(e.target.value)
                        }
                        className="h-9"
                      />
                    </Field>
                    <Field label="Expiry Date">
                      <Input
                        type="date"
                        value={expDate}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setExpDate(e.target.value)
                        }
                        className="h-9"
                      />
                    </Field>
                    <Field label="Batch Number" full>
                      <Input
                        value={batchNumber}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setBatchNumber(e.target.value)
                        }
                        className="h-9"
                        placeholder="BATCH-2025-09"
                      />
                    </Field>
                    <Field label="Purchase Price">
                      <Input
                        value={purchasePrice}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setPurchasePrice(fmtMoneyInput(e.target.value))
                        }
                        className="h-9"
                        inputMode="decimal"
                        placeholder="0.00"
                      />
                    </Field>
                    <Field label="Selling Price">
                      <Input
                        value={sellingPrice}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setSellingPrice(fmtMoneyInput(e.target.value))
                        }
                        className="h-9"
                        inputMode="decimal"
                        placeholder="0.00"
                      />
                    </Field>
                    <Field label="Supplier" full>
                      <Input
                        value={supplierName}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setSupplierName(e.target.value)
                        }
                        className="h-9"
                        placeholder="ACME Pharma"
                      />
                    </Field>
                    <Field label="Total Quantity">
                      <Input
                        value={qty}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setQty(e.target.value.replace(/[^\d]/g, ''))
                        }
                        className="h-9"
                        inputMode="numeric"
                        placeholder="e.g., 120"
                      />
                    </Field>
                    <Field label="Reorder Level (Min Qty)">
                      <Input
                        value={minQty}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setMinQty(e.target.value.replace(/[^\d]/g, ''))
                        }
                        className="h-9"
                        inputMode="numeric"
                        placeholder="e.g., 20"
                      />
                    </Field>

                    {/* Shelf & capacity */}
                    <div className="md:col-span-2 rounded-xl border border-white/40 bg-white/60 p-3">
                      <div className="grid grid-cols-1 md:grid-cols-[minmax(220px,340px)_1fr_auto] gap-2 items-end">
                        <div>
                          <Label className="text-slate-700 text-xs">Shelf</Label>
                          <select
                            className="w-full h-9 rounded-md border border-white/40 bg-white/90 px-2 text-sm"
                            value={selectedShelfId ?? ''}
                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                              setSelectedShelfId(e.target.value ? Number(e.target.value) : '')
                            }
                          >
                            <option value="">— Select shelf —</option>
                            {shelves.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="text-xs rounded-lg border border-white/40 bg-white/70 p-2">
                          {selectedShelf ? (
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="inline-flex items-center gap-1">
                                <HardDrive className="h-3.5 w-3.5" /> Cap: <b>{selectedShelf.capacity}</b>
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <Gauge className="h-3.5 w-3.5" /> Used: <b>{selectedShelf.usedCapacity}</b>
                              </span>
                              <span>
                                Free: <b>{Math.max(0, selectedShelf.capacity - selectedShelf.usedCapacity)}</b>
                              </span>
                              {exceedsCapacity && (
                                <span className="text-rose-600 font-medium">Not enough capacity</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-600">Pick a shelf to see capacity.</span>
                          )}
                        </div>

                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="h-9"
                            onClick={() => {
                              // eslint-disable-next-line no-alert
                              const name = prompt('New shelf name?');
                              if (!name?.trim()) return;
                              // eslint-disable-next-line no-alert
                              const capStr = prompt('Maximum capacity for this shelf?', '100');
                              const cap = Math.max(1, Number(capStr || '0'));
                              addShelfInline(name.trim(), cap);
                            }}
                            title="Quick add shelf"
                          >
                            <Plus className="h-4 w-4 mr-1" /> New shelf
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Details (restored) */}
                  <div className="rounded-xl border border-white/40 bg-white/60 overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-white/70"
                      onClick={() => setShowDetails((v) => !v)}
                    >
                      <span className="font-medium">Details</span>
                      <ChevronDown className={`h-4 w-4 transition ${showDetails ? 'rotate-180' : ''}`} />
                    </button>
                    {showDetails && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 px-3 pb-3">
                        <Field label="Slips Count">
                          <Input
                            value={slipsCount}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                              setSlipsCount(e.target.value.replace(/[^\d]/g, ''))
                            }
                            className="h-9"
                            inputMode="numeric"
                          />
                        </Field>
                        <Field label="Tablets / Slip">
                          <Input
                            value={tabsPerSlip}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                              setTabsPerSlip(e.target.value.replace(/[^\d]/g, ''))
                            }
                            className="h-9"
                            inputMode="numeric"
                          />
                        </Field>
                        <Field label="Total Tablets">
                          <Input
                            value={totalTabs}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                              setTotalTabs(e.target.value.replace(/[^\d]/g, ''))
                            }
                            className="h-9"
                            inputMode="numeric"
                          />
                        </Field>

                        <Field label="MRP Amount">
                          <Input
                            value={mrpAmount}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                              setMrpAmount(fmtMoneyInput(e.target.value))
                            }
                            className="h-9"
                            inputMode="decimal"
                          />
                        </Field>
                        <Field label="MRP Currency">
                          <Input
                            value={mrpCurrency}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                              setMrpCurrency(e.target.value)
                            }
                            className="h-9"
                          />
                        </Field>
                        <Field label="MRP Text">
                          <Input
                            value={mrpText}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                              setMrpText(e.target.value)
                            }
                            className="h-9"
                            placeholder="220.00/10CAPS."
                          />
                        </Field>

                        <Field label="Inferred Uses (comma)" full>
                          <Input
                            value={uses}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUses(e.target.value)}
                            className="h-9"
                          />
                        </Field>
                        <Field label="Care Notes (comma)" full>
                          <Input
                            value={care}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCare(e.target.value)}
                            className="h-9"
                          />
                        </Field>
                        <Field label="Side Effects (comma)" full>
                          <Input
                            value={effects}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEffects(e.target.value)}
                            className="h-9"
                          />
                        </Field>
                        <Field label="Avoid If (comma)" full>
                          <Input
                            value={avoid}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAvoid(e.target.value)}
                            className="h-9"
                          />
                        </Field>
                        <Field label="Precautions (comma)" full>
                          <Input
                            value={precautions}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                              setPrecautions(e.target.value)
                            }
                            className="h-9"
                          />
                        </Field>
                        <Field label="Interactions (comma)" full>
                          <Input
                            value={interactions}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                              setInteractions(e.target.value)
                            }
                            className="h-9"
                          />
                        </Field>
                      </div>
                    )}
                  </div>

                  {addMsg && (
                    <p className={`text-sm ${addMsg.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {addMsg.text}
                    </p>
                  )}

                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="secondary"
                      className="h-9 text-sm px-3"
                      onClick={resetAddForm}
                      disabled={adding}
                    >
                      Reset
                    </Button>
                    <Button className="h-9 text-sm px-4" onClick={() => void submitAdd()} disabled={adding}>
                      {adding ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* LIST / UPDATE / DELETE */}
            {(section === 'all' || section === 'update' || section === 'delete') && (
              <Card className="bg-white/60 backdrop-blur-lg border-white/40">
                <CardHeader className="pb-2 pt-3 md:pt-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <CardTitle className="text-lg sm:text-xl">
                      {section === 'update' ? 'Update' : section === 'delete' ? 'Delete' : 'All Medicines'}
                    </CardTitle>
                    <div className="sm:ml-auto flex gap-2 w-full sm:w-auto">
                      <div className="relative w-full sm:w-72">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                          value={q}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
                          placeholder="Search…"
                          className="pl-8 h-9 w-full"
                        />
                      </div>
                      <Button variant="outline" className="h-9" onClick={() => void fetchItems()}>
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-3 md:p-4">
                  <div className="rounded-lg border border-white/40 bg-white/60 overflow-hidden">
                    <div className="max-h-[48vh] overflow-auto">
                      <table className="min-w-[980px] w-full text-left text-[13px] text-slate-800">
                        <thead className="bg-white/70 sticky top-0 z-10">
                          <tr>
                            <Th>ID</Th>
                            <Th>Name</Th>
                            <Th>Qty</Th>
                            <Th>Reorder</Th>
                            <Th>Supplier</Th>
                            <Th>Expiry</Th>
                            <Th>Shelves</Th>
                            <Th className="text-right pr-3">Actions</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.length === 0 ? (
                            <tr>
                              <td className="px-3 py-3 text-slate-500" colSpan={8}>
                                No medicines
                              </td>
                            </tr>
                          ) : (
                            items.map((it) => (
                              <tr key={it.id} className="odd:bg-white/50">
                                <Td>{it.id}</Td>
                                <Td>{it.name}</Td>
                                <Td>{it.qty}</Td>
                                <Td>{it.minQty || '-'}</Td>
                                <Td>{it.supplierName ?? '-'}</Td>
                                <Td>{fmtFriendly(it.expiryDate)}</Td>
                                <Td>
                                  {it.shelves?.length
                                    ? it.shelves.map((s) => `${s.shelfName}:${s.qty}`).join(' | ')
                                    : '-'}
                                </Td>
                                <Td className="text-right pr-3">
                                  {section !== 'delete' ? (
                                    <Button size="sm" className="h-8 px-2" onClick={() => startEdit(it)}>
                                      <Pencil className="h-4 w-4 mr-1" /> Edit
                                    </Button>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      className="h-8 px-2"
                                      onClick={() => void deleteById(it.id)}
                                    >
                                      <Trash2 className="h-4 w-4 mr-1" /> Delete
                                    </Button>
                                  )}
                                </Td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {section === 'update' && edit && (
                    <div className="mt-4">
                      <Card className="bg-white/60 backdrop-blur-lg border-white/40 max-w-3xl">
                        <CardHeader className="pb-1 pt-3 md:pt-4">
                          <CardTitle className="text-xl">Edit: {eId}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 p-3 md:p-6">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <Field label="ID">
                              <Input value={eId} disabled className="h-9" />
                            </Field>
                            <Field label="Name">
                              <Input
                                value={eName}
                                onChange={(ev: React.ChangeEvent<HTMLInputElement>) =>
                                  setEName(ev.target.value)
                                }
                                className="h-9"
                              />
                            </Field>
                            <Field label="Manufacturing Date">
                              <Input
                                type="date"
                                value={eMfg}
                                onChange={(ev: React.ChangeEvent<HTMLInputElement>) =>
                                  setEMfg(ev.target.value)
                                }
                                className="h-9"
                              />
                            </Field>
                            <Field label="Expiry Date">
                              <Input
                                type="date"
                                value={eExp}
                                onChange={(ev: React.ChangeEvent<HTMLInputElement>) =>
                                  setEExp(ev.target.value)
                                }
                                className="h-9"
                              />
                            </Field>
                            <Field label="Batch Number" full>
                              <Input
                                value={eBatch}
                                onChange={(ev: React.ChangeEvent<HTMLInputElement>) =>
                                setEBatch(ev.target.value)
                                }
                                className="h-9"
                              />
                            </Field>
                            <Field label="Purchase Price">
                              <Input
                                value={eBuy}
                                onChange={(ev: React.ChangeEvent<HTMLInputElement>) =>
                                  setEBuy(fmtMoneyInput(ev.target.value))
                                }
                                className="h-9"
                              />
                            </Field>
                            <Field label="Selling Price">
                              <Input
                                value={eSell}
                                onChange={(ev: React.ChangeEvent<HTMLInputElement>) =>
                                  setESell(fmtMoneyInput(ev.target.value))
                                }
                                className="h-9"
                              />
                            </Field>
                            <Field label="Supplier" full>
                              <Input
                                value={eSupplier}
                                onChange={(ev: React.ChangeEvent<HTMLInputElement>) =>
                                  setESupplier(ev.target.value)
                                }
                                className="h-9"
                              />
                            </Field>
                            <Field label="Total Quantity">
                              <Input
                                value={eQty}
                                onChange={(ev: React.ChangeEvent<HTMLInputElement>) =>
                                  setEQty(ev.target.value.replace(/[^\d]/g, ''))
                                }
                                className="h-9"
                              />
                            </Field>
                            <Field label="Reorder Level (Min Qty)">
                              <Input
                                value={eMinQty}
                                onChange={(ev: React.ChangeEvent<HTMLInputElement>) =>
                                  setEMinQty(ev.target.value.replace(/[^\d]/g, ''))
                                }
                                className="h-9"
                              />
                            </Field>
                          </div>

                          <div className="rounded-xl border border-white/40 bg-white/60 p-3">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-sm font-medium">Shelf Allocations</h4>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8"
                                  onClick={() =>
                                    setEShelves((s) => [
                                      ...s,
                                      { shelfId: cryptoRandom(), shelfName: '', qty: 0, shelfRefId: null },
                                    ])
                                  }
                                >
                                  <Plus className="h-4 w-4 mr-1" /> Add row
                                </Button>
                              </div>
                            </div>
                            {eShelves.length === 0 ? (
                              <p className="text-sm text-slate-600">No shelves.</p>
                            ) : (
                              <div className="space-y-2">
                                {eShelves.map((row, idx) => (
                                  <div
                                    key={`${row.shelfId}-${idx}`}
                                    className="grid grid-cols-1 md:grid-cols-[240px_1fr_120px_90px] gap-2"
                                  >
                                    <Input
                                      placeholder="Shelf name"
                                      value={row.shelfName}
                                      onChange={(ev: React.ChangeEvent<HTMLInputElement>) =>
                                        setEShelves((r) =>
                                          r.map((x, i) =>
                                            i === idx ? { ...x, shelfName: ev.target.value } : x
                                          )
                                        )
                                      }
                                    />
                                    <div className="md:col-span-1" />
                                    <Input
                                      placeholder="Qty"
                                      value={String(row.qty)}
                                      onChange={(ev: React.ChangeEvent<HTMLInputElement>) =>
                                        setEShelves((r) =>
                                          r.map((x, i) =>
                                            i === idx ? { ...x, qty: toNum(ev.target.value) } : x
                                          )
                                        )
                                      }
                                    />
                                    <Button
                                      variant="destructive"
                                      className="h-9"
                                      onClick={() =>
                                        setEShelves((r) => r.filter((_, i) => i !== idx))
                                      }
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {uMsg && (
                            <p className={`text-sm ${uMsg.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {uMsg.text}
                            </p>
                          )}
                          <div className="flex gap-2">
                            <Button
                              variant="secondary"
                              className="h-9 text-sm px-3"
                              onClick={cancelEdit}
                            >
                              Cancel
                            </Button>
                            <Button
                              className="h-9 text-sm px-4"
                              onClick={() => void saveEdit()}
                              disabled={updating}
                            >
                              {updating ? 'Saving…' : 'Save Changes'}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {section === 'delete' && (dMsg || listMsg) && (
                    <p
                      className={`mt-2 text-sm ${
                        (dMsg ?? listMsg)!.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {(dMsg ?? listMsg)!.text}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* SHELVES tab */}
            {section === 'shelves' && (
              <Card className="bg-white/60 backdrop-blur-lg border-white/40">
                <CardHeader className="pb-2 pt-3 md:pt-4">
                  <div className="flex items-center gap-2 w-full">
                    <CardTitle className="text-lg sm:text-xl">Shelves</CardTitle>
                    <div className="ml-auto flex gap-2">
                      <InlineAddShelf onAdd={(name, cap) => addShelfInline(name, cap)} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-3 md:p-4">
                  <div className="rounded-lg border border-white/40 bg-white/60 overflow-hidden">
                    <div className="max-h-[48vh] overflow-auto">
                      <table className="min-w-[720px] w-full text-left text-[13px] text-slate-800">
                        <thead className="bg-white/70 sticky top-0 z-10">
                          <tr>
                            <Th>ID</Th>
                            <Th>Name</Th>
                            <Th>Max Capacity</Th>
                            <Th>Used</Th>
                            <Th>Free</Th>
                            <Th className="text-right pr-3">Actions</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {shelves.length === 0 ? (
                            <tr>
                              <td className="px-3 py-3 text-slate-500" colSpan={6}>
                                No shelves
                              </td>
                            </tr>
                          ) : (
                            shelves.map((sh) => {
                              const free = Math.max(0, sh.capacity - sh.usedCapacity);
                              return (
                                <tr key={sh.id} className="odd:bg-white/50">
                                  <Td>{sh.id}</Td>
                                  <Td>{sh.name}</Td>
                                  <Td>{sh.capacity}</Td>
                                  <Td>{sh.usedCapacity}</Td>
                                  <Td>{free}</Td>
                                  <Td className="text-right pr-3 space-x-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 px-2"
                                      onClick={() => {
                                        // eslint-disable-next-line no-alert
                                        const name = prompt('Shelf name', sh.name) ?? sh.name;
                                        // eslint-disable-next-line no-alert
                                        const capStr =
                                          prompt('Max capacity', String(sh.capacity)) ??
                                          String(sh.capacity);
                                        const cap = Math.max(1, Number(capStr || '1'));
                                        updateShelfInline(sh.id, {
                                          name: name.trim(),
                                          capacity: cap,
                                        });
                                      }}
                                    >
                                      Edit
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      className="h-8 px-2"
                                      onClick={() => deleteShelfInline(sh.id)}
                                    >
                                      <Trash2 className="h-4 w-4 mr-1" /> Delete
                                    </Button>
                                  </Td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {cameraOpen && (
  <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center">
    <div className="bg-white rounded-xl shadow-2xl w-[92vw] max-w-lg overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div className="font-medium">Take photos ({camShots.length}/{MAX_FILES})</div>
        <button className="text-sm" onClick={closeCamera}>Close</button>
      </div>

      <div className="p-3 space-y-3">
        {/* Live video */}
        <div className="relative rounded-lg overflow-hidden bg-black">
          <video
            autoPlay
            playsInline
            muted
            ref={el => { if (el && camStream && el.srcObject !== camStream) el.srcObject = camStream; }}
            className="w-full h-auto"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            className="h-10"
            onClick={() => {
              const videoEl = document.querySelector('video') as HTMLVideoElement | null;
              if (!videoEl) return;
              if (camShots.length >= MAX_FILES) {
                setScanMsg({ kind:'err', text:`You already have ${MAX_FILES} shots.` });
                return;
              }
              captureFromVideo(videoEl);
            }}
          >
            Capture
          </Button>

          <Button
            variant="secondary"
            className="h-10"
            onClick={() => { setCamShots([]); }}
            disabled={camShots.length === 0}
          >
            Clear
          </Button>

          <Button
            className="h-10 ml-auto"
            onClick={confirmCameraShots}
            disabled={camShots.length < MIN_FILES}
          >
            Use {camShots.length} photos
          </Button>
        </div>

        {/* Thumbnails */}
        {camShots.length > 0 && (
          <div className="flex flex-wrap gap-2 max-h-40 overflow-auto">
            {camShots.map((url, i) => (
              <div key={i} className="relative">
                <img src={url} className="h-16 w-16 object-cover rounded border" />
                <button
                  className="absolute -top-1 -right-1 bg-white rounded-full border px-1 text-xs"
                  onClick={() => setCamShots(prev => prev.filter((_, idx) => idx !== i))}
                >x</button>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-slate-600">
          Tip: minimum {MIN_FILES}, maximum {MAX_FILES}. For documents, hold steady and fill the frame.
        </p>
      </div>
    </div>
  </div>
)}

      </Rnd>
    </>
  );
}

/* ---------- small bits ---------- */
function Field({
  label,
  children,
  full = false,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={`space-y-1 ${full ? 'md:col-span-2' : ''}`}>
      <Label className="text-slate-700 text-xs">{label}</Label>
      {children}
    </div>
  );
}
function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-xs font-semibold text-slate-600 ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
const splitList = (s: string): string[] =>
  s.split(',').map((x) => x.trim()).filter(Boolean);

/* ---------- Mobile helpers ---------- */

function MobileShelvesLocal({
  shelves,
  onAdd,
  onDelete,
  onUpdate,
}: {
  shelves: ShelfInfo[];
  onAdd: (name: string, capacity: number) => void;
  onDelete: (id: number) => void;
  onUpdate: (id: number, patch: Partial<ShelfInfo>) => void;
}) {
  return (
    <div className="space-y-2">
      <InlineAddShelf onAdd={onAdd} />
      <div className="rounded-lg border border-white/40 bg-white/70">
        {shelves.length === 0 ? (
          <div className="p-3 text-sm text-slate-600">No shelves</div>
        ) : (
          shelves.map((s) => {
            const free = Math.max(0, s.capacity - s.usedCapacity);
            return (
              <div key={s.id} className="p-3 border-b border-white/40 flex items-center justify-between">
                <div className="text-sm">
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-slate-600">
                    Capacity: {s.capacity} • Used: {s.usedCapacity} • Free: {free}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      // eslint-disable-next-line no-alert
                      const name = prompt('Shelf name', s.name) ?? s.name;
                      // eslint-disable-next-line no-alert
                      const capStr = prompt('Max capacity', String(s.capacity)) ?? String(s.capacity);
                      const cap = Math.max(1, Number(capStr || '1'));
                      onUpdate(s.id, { name: name.trim(), capacity: cap });
                    }}
                  >
                    Edit
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => onDelete(s.id)}>
                    <Trash2 className="h-4 w-4 mr-1" /> Delete
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

type MobileAddSimpleProps = {
  medName: string;
  setMedName: React.Dispatch<React.SetStateAction<string>>;
  medId: string;
  setMedId: React.Dispatch<React.SetStateAction<string>>;
  mfgDate: string;
  setMfgDate: React.Dispatch<React.SetStateAction<string>>;
  expDate: string;
  setExpDate: React.Dispatch<React.SetStateAction<string>>;
  batchNumber: string;
  setBatchNumber: React.Dispatch<React.SetStateAction<string>>;
  purchasePrice: string;
  setPurchasePrice: React.Dispatch<React.SetStateAction<string>>;
  sellingPrice: string;
  setSellingPrice: React.Dispatch<React.SetStateAction<string>>;
  supplierName: string;
  setSupplierName: React.Dispatch<React.SetStateAction<string>>;
  qty: string;
  setQty: React.Dispatch<React.SetStateAction<string>>;
  minQty: string;
  setMinQty: React.Dispatch<React.SetStateAction<string>>;
  selectedShelfId: number | '';
  setSelectedShelfId: React.Dispatch<React.SetStateAction<number | ''>>;
  shelves: ShelfInfo[];
  freeOnSelected: number;
  exceedsCapacity: boolean;
  addMsg: { kind: 'ok' | 'err'; text: string } | null;
  adding: boolean;
  submitAdd: () => Promise<void>;

  slipsCount: string;
  setSlipsCount: React.Dispatch<React.SetStateAction<string>>;
  tabsPerSlip: string;
  setTabsPerSlip: React.Dispatch<React.SetStateAction<string>>;
  totalTabs: string;
  setTotalTabs: React.Dispatch<React.SetStateAction<string>>;
  mrpAmount: string;
  setMrpAmount: React.Dispatch<React.SetStateAction<string>>;
  mrpCurrency: string;
  setMrpCurrency: React.Dispatch<React.SetStateAction<string>>;
  mrpText: string;
  setMrpText: React.Dispatch<React.SetStateAction<string>>;
  uses: string;
  setUses: React.Dispatch<React.SetStateAction<string>>;
  care: string;
  setCare: React.Dispatch<React.SetStateAction<string>>;
  effects: string;
  setEffects: React.Dispatch<React.SetStateAction<string>>;
  avoid: string;
  setAvoid: React.Dispatch<React.SetStateAction<string>>;
  precautions: string;
  setPrecautions: React.Dispatch<React.SetStateAction<string>>;
  interactions: string;
  setInteractions: React.Dispatch<React.SetStateAction<string>>;
  showDetails: boolean;
  setShowDetails: React.Dispatch<React.SetStateAction<boolean>>;
  setAddMsg: React.Dispatch<
    React.SetStateAction<{ kind: 'ok' | 'err'; text: string } | null>
  >;
};

function MobileAddSimple(props: MobileAddSimpleProps) {
  const {
    medName,
    setMedName,
    medId,
    setMedId,
    mfgDate,
    setMfgDate,
    expDate,
    setExpDate,
    batchNumber,
    setBatchNumber,
    purchasePrice,
    setPurchasePrice,
    sellingPrice,
    setSellingPrice,
    supplierName,
    setSupplierName,
    qty,
    setQty,
    minQty,
    setMinQty,
    selectedShelfId,
    setSelectedShelfId,
    shelves,
    freeOnSelected,
    exceedsCapacity,
    addMsg,
    adding,
    submitAdd,
    slipsCount,
    setSlipsCount,
    tabsPerSlip,
    setTabsPerSlip,
    totalTabs,
    setTotalTabs,
    mrpAmount,
    setMrpAmount,
    mrpCurrency,
    setMrpCurrency,
    mrpText,
    setMrpText,
    uses,
    setUses,
    care,
    setCare,
    effects,
    setEffects,
    avoid,
    setAvoid,
    precautions,
    setPrecautions,
    interactions,
    setInteractions,
    showDetails,
    setShowDetails,
    setAddMsg,
  } = props;

  return (
    <>
      <div className="grid grid-cols-1 gap-3">
        <Field label="Name">
          <Input
            value={medName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMedName(e.target.value)}
            className="h-10"
          />
        </Field>
        <Field label="ID">
          <Input
            value={medId}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMedId(e.target.value)}
            className="h-10"
          />
        </Field>
        <Field label="Manufacturing Date">
          <Input
            type="date"
            value={mfgDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMfgDate(e.target.value)}
            className="h-10"
          />
        </Field>
        <Field label="Expiry Date">
          <Input
            type="date"
            value={expDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExpDate(e.target.value)}
            className="h-10"
          />
        </Field>
        <Field label="Batch Number">
          <Input
            value={batchNumber}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBatchNumber(e.target.value)}
            className="h-10"
          />
        </Field>
        <Field label="Purchase Price">
          <Input
            value={purchasePrice}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setPurchasePrice(fmtMoneyInput(e.target.value))
            }
            className="h-10"
          />
        </Field>
        <Field label="Selling Price">
          <Input
            value={sellingPrice}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setSellingPrice(fmtMoneyInput(e.target.value))
            }
            className="h-10"
          />
        </Field>
        <Field label="Supplier">
          <Input
            value={supplierName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSupplierName(e.target.value)}
            className="h-10"
          />
        </Field>
        <Field label="Total Quantity">
          <Input
            value={qty}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setQty(e.target.value.replace(/[^\d]/g, ''))
            }
            className="h-10"
          />
        </Field>
        <Field label="Reorder Level (Min Qty)">
          <Input
            value={minQty}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setMinQty(e.target.value.replace(/[^\d]/g, ''))
            }
            className="h-10"
          />
        </Field>

        <div className="rounded-xl border border-white/40 bg-white/70 p-3">
          <Label className="text-xs">Shelf</Label>
          <select
            className="w-full h-10 rounded-md border border-white/40 bg-white/90 px-2 text-sm mt-1"
            value={selectedShelfId ?? ''}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              setSelectedShelfId(e.target.value ? Number(e.target.value) : '')
            }
          >
            <option value="">— Select shelf —</option>
            {shelves.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="text-xs mt-2">
            {selectedShelfId ? (
              <span>
                Free: <b>{freeOnSelected}</b>
                {exceedsCapacity && (
                  <span className="ml-2 text-rose-600 font-medium">Not enough capacity</span>
                )}
              </span>
            ) : (
              <span className="text-slate-600">Pick a shelf to see capacity.</span>
            )}
          </div>
        </div>

        {/* Details (mobile) */}
        <button
          className="w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg border border-white/40 bg-white/70"
          onClick={() => setShowDetails((v) => !v)}
        >
          <span className="font-medium">Details</span>
          <ChevronDown className={`h-4 w-4 transition ${showDetails ? 'rotate-180' : ''}`} />
        </button>
        {showDetails && (
          <div className="grid grid-cols-1 gap-3">
            <Field label="Slips Count">
              <Input
                value={slipsCount}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setSlipsCount(e.target.value.replace(/[^\d]/g, ''))
                }
                className="h-10"
              />
            </Field>
            <Field label="Tablets / Slip">
              <Input
                value={tabsPerSlip}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setTabsPerSlip(e.target.value.replace(/[^\d]/g, ''))
                }
                className="h-10"
              />
            </Field>
            <Field label="Total Tablets">
              <Input
                value={totalTabs}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setTotalTabs(e.target.value.replace(/[^\d]/g, ''))
                }
                className="h-10"
              />
            </Field>
            <Field label="MRP Amount">
              <Input
                value={mrpAmount}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setMrpAmount(fmtMoneyInput(e.target.value))
                }
                className="h-10"
              />
            </Field>
            <Field label="MRP Currency">
              <Input
                value={mrpCurrency}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMrpCurrency(e.target.value)}
                className="h-10"
              />
            </Field>
            <Field label="MRP Text">
              <Input
                value={mrpText}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMrpText(e.target.value)}
                className="h-10"
              />
            </Field>
            <Field label="Uses (comma)">
              <Input
                value={uses}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUses(e.target.value)}
                className="h-10"
              />
            </Field>
            <Field label="Care Notes (comma)">
              <Input
                value={care}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCare(e.target.value)}
                className="h-10"
              />
            </Field>
            <Field label="Side Effects (comma)">
              <Input
                value={effects}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEffects(e.target.value)}
                className="h-10"
              />
            </Field>
            <Field label="Avoid If (comma)">
              <Input
                value={avoid}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAvoid(e.target.value)}
                className="h-10"
              />
            </Field>
            <Field label="Precautions (comma)">
              <Input
                value={precautions}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPrecautions(e.target.value)}
                className="h-10"
              />
            </Field>
            <Field label="Interactions (comma)">
              <Input
                value={interactions}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInteractions(e.target.value)}
                className="h-10"
              />
            </Field>
          </div>
        )}
      </div>

      {addMsg && (
        <p className={`mt-3 text-sm ${addMsg.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}>
          {addMsg.text}
        </p>
      )}
      <div className="flex gap-2 mt-2">
        <Button
          variant="secondary"
          className="h-10"
          onClick={() => {
            props.setMedId('');
            props.setMedName('');
            props.setMfgDate('');
            props.setExpDate('');
            props.setBatchNumber('');
            props.setPurchasePrice('');
            props.setSellingPrice('');
            props.setSupplierName('');
            props.setQty('');
            props.setMinQty('');
            props.setAddMsg(null);
            props.setSelectedShelfId('');
            props.setSlipsCount('');
            props.setTabsPerSlip('');
            props.setTotalTabs('');
            props.setMrpAmount('');
            props.setMrpText('');
            props.setUses('');
            props.setCare('');
            props.setEffects('');
            props.setAvoid('');
            props.setPrecautions('');
            props.setInteractions('');
          }}
          disabled={adding}
        >
          Reset
        </Button>
        <Button className="h-10" onClick={() => void submitAdd()} disabled={adding}>
          {adding ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </>
  );
}

type MobileListCrudProps = {
  section: Section;
  q: string;
  setQ: React.Dispatch<React.SetStateAction<string>>;
  loading: boolean;
  fetchItems: () => Promise<void>;
  items: Item[];
  startEdit: (it: Item) => void;
  deleteById: (id: string) => Promise<void>;

  // edit fields + setters
  eId: string;
  eName: string;
  eMfg: string;
  eExp: string;
  eBatch: string;
  eBuy: string;
  eSell: string;
  eSupplier: string;
  eQty: string;
  eMinQty: string;
  setEName: React.Dispatch<React.SetStateAction<string>>;
  setEMfg: React.Dispatch<React.SetStateAction<string>>;
  setEExp: React.Dispatch<React.SetStateAction<string>>;
  setEBatch: React.Dispatch<React.SetStateAction<string>>;
  setEBuy: React.Dispatch<React.SetStateAction<string>>;
  setESell: React.Dispatch<React.SetStateAction<string>>;
  setESupplier: React.Dispatch<React.SetStateAction<string>>;
  setEQty: React.Dispatch<React.SetStateAction<string>>;
  setEMinQty: React.Dispatch<React.SetStateAction<string>>;
  eShelves: ShelfAlloc[];
  setEShelves: React.Dispatch<React.SetStateAction<ShelfAlloc[]>>;
  cancelEdit: () => void;
  saveEdit: () => Promise<void>;
  uMsg: { kind: 'ok' | 'err'; text: string } | null;
  updating: boolean;
  listMsg: { kind: 'ok' | 'err'; text: string } | null;
  dMsg: { kind: 'ok' | 'err'; text: string } | null;
};

function MobileListCrud(props: MobileListCrudProps) {
  const { section } = props;
  return (
    <>
      <div className="mb-2 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            value={props.q}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => props.setQ(e.target.value)}
            placeholder="Search…"
            className="pl-8 h-10 w-full"
          />
        </div>
        <Button variant="outline" className="h-10" onClick={() => void props.fetchItems()}>
          <RefreshCw className={`h-4 w-4 ${props.loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>
      <div className="rounded-lg border border-white/40 bg-white/70 overflow-hidden">
        {props.items.length === 0 ? (
          <div className="p-3 text-sm text-slate-600">No medicines</div>
        ) : (
          props.items.map((it) => (
            <div key={it.id} className="p-3 border-b border-white/40">
              <div className="text-sm font-medium">{it.name}</div>
              <div className="text-xs text-slate-600">
                ID: {it.id} • Supplier: {it.supplierName ?? '-'}
              </div>
              <div className="mt-2 flex gap-2">
                {props.section !== 'delete' ? (
                  <Button size="sm" onClick={() => props.startEdit(it)}>
                    Edit
                  </Button>
                ) : (
                  <Button size="sm" variant="destructive" onClick={() => void props.deleteById(it.id)}>
                    Delete
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

/* Inline “add shelf” control */
function InlineAddShelf({ onAdd }: { onAdd: (name: string, capacity: number) => void }) {
  const [n, setN] = useState('');
  const [c, setC] = useState('');
  return (
    <div className="flex items-end gap-2">
      <div>
        <Label className="text-xs">Shelf Name</Label>
        <Input
          value={n}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setN(e.target.value)}
          className="h-9 w-40"
          placeholder="Shelf A"
        />
      </div>
      <div>
        <Label className="text-xs">Max Capacity</Label>
        <Input
          value={c}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setC(e.target.value.replace(/[^\d]/g, ''))
          }
          className="h-9 w-36"
          placeholder="100"
          inputMode="numeric"
        />
      </div>
      <Button
        className="h-9"
        onClick={() => {
          if (!n.trim() || !c.trim()) return;
          onAdd(n.trim(), Math.max(1, Number(c)));
          setN('');
          setC('');
        }}
      >
        <Plus className="h-4 w-4 mr-1" /> Add
      </Button>
    </div>
  );
}
