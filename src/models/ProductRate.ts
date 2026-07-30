import mongoose, { Schema, Document } from 'mongoose';

export interface IProductRate extends Document {
  category: string; // 'Window', 'Door', 'Partition', 'Fix'
  attributes: Record<string, string>; // e.g., { track: '2T', gauge: '16G' }
  pricePerSqFt: number;
  minStandardSqft?: number;
  fixedPriceUnderStandard?: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ProductRateSchema: Schema = new Schema(
  {
    category: { type: String, required: true, index: true },
    attributes: { type: Map, of: String, default: {} },
    pricePerSqFt: { type: Number, required: true, min: 0 },
    minStandardSqft: { type: Number, default: 0, min: 0 },
    fixedPriceUnderStandard: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

ProductRateSchema.index({ category: 1, isActive: 1 });

export default mongoose.model<IProductRate>('ProductRate', ProductRateSchema);
