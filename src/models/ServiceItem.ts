import mongoose, { Schema, Document } from 'mongoose';

export interface ISizeEntry {
  widthFeet: number;
  widthInches: number;
  heightFeet: number;
  heightInches: number;
  areaSqFt: number;
  ratePerSqFt: number;
  pricingType: 'Per SqFt' | 'Fixed';
  calculatedPrice: number;
  manualPrice?: number | null;
  effectivePrice: number;
  quantity: number;
  lineTotal: number;
}

export interface IServiceItem extends Document {
  workId: mongoose.Types.ObjectId;
  serviceCategory: string;
  configuration: Record<string, string>;
  sizeEntries: ISizeEntry[];
  totalCalculatedPrice: number;
  manualTotalPrice?: number | null;
  effectiveTotalPrice: number;
  description?: string;
  notes?: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const SizeEntrySchema = new Schema<ISizeEntry>({
  widthFeet: { type: Number, required: true },
  widthInches: { type: Number, default: 0 },
  heightFeet: { type: Number, required: true },
  heightInches: { type: Number, default: 0 },
  areaSqFt: { type: Number, default: 0 },
  ratePerSqFt: { type: Number, default: 0 },
  pricingType: { type: String, enum: ['Per SqFt', 'Fixed'], default: 'Per SqFt' },
  calculatedPrice: { type: Number, default: 0 },
  manualPrice: { type: Number },
  effectivePrice: { type: Number, default: 0 },
  quantity: { type: Number, default: 1 },
  lineTotal: { type: Number, default: 0 },
});

const ServiceItemSchema: Schema = new Schema(
  {
    workId: { type: Schema.Types.ObjectId, ref: 'Work', required: true },
    serviceCategory: {
      type: String,
      required: true
    },
    configuration: { type: Map, of: String, default: {} },
    sizeEntries: [SizeEntrySchema],
    totalCalculatedPrice: { type: Number, default: 0 },
    manualTotalPrice: { type: Number },
    effectiveTotalPrice: { type: Number, default: 0 },
    description: { type: String },
    notes: { type: String },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

ServiceItemSchema.index({ workId: 1, sortOrder: 1 });

export default mongoose.model<IServiceItem>('ServiceItem', ServiceItemSchema);
