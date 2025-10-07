export type TrendPoint = { date: string; sales: number; profit: number };
export type TopItem    = { name: string; qty: number; revenue: number };
export type Category   = { name: string; value: number };
export type Aging      = { bucket: string; qty: number };
export type Summary    = { revenue: number; profit: number; orders: number; items: number };
export type AlertRow   = { id: string; name: string; qty: number; expiry?: string | null };

export type ApiReports = {
  trend: TrendPoint[];
  top: TopItem[];
  cats: Category[];
  aging: Aging[];
  alerts: AlertRow[];
  summary: Summary;
  error?: string;
};
