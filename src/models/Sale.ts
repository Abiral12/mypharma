import mongoose, { Schema, Model, Document } from 'mongoose';

export interface ISaleLine {
  id: string;       // batchNo or item id
  name: string;
  price: number;    // sellingPrice at the time
  qty: number;
  lineTotal: number;
}

export interface ISale extends Document {
  total: number;
  lines: ISaleLine[];
  note?: string | null;
  createdAt: Date;
  createdBy?: string | null; // optional user id/name
}

const SaleLineSchema = new Schema<ISaleLine>({
  id: { type: String, required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  qty: { type: Number, required: true, min: 1 },
  lineTotal: { type: Number, required: true },
}, { _id: false });

const SaleSchema = new Schema<ISale>({
  total: { type: Number, required: true },
  lines: { type: [SaleLineSchema], required: true },
  note: { type: String, default: null },
  createdAt: { type: Date, default: () => new Date(), index: true },
  createdBy: { type: String, default: null },
});

export default (mongoose.models.Sale as Model<ISale>) || mongoose.model<ISale>('Sale', SaleSchema);
