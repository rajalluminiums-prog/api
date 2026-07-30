import mongoose, { Schema, Document } from 'mongoose';

export interface IWork extends Document {
  customerId: mongoose.Types.ObjectId;
  workNumber: string;
  title: string;
  status: 'draft' | 'quotation_sent' | 'waiting_advance' | 'in_progress' | 'completed' | 'invoiced' | 'archived' | 'cancelled';
  startDate?: Date;
  expectedCompletionDate?: Date;
  completedDate?: Date;
  calculatedTotal: number;
  manualTotal?: number | null;
  discountType?: 'percentage' | 'fixed';
  discountValue: number;
  discountedTotal?: number;
  finalAmount: number;
  totalAdvance: number;
  remainingBalance: number;
  notes?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const WorkSchema: Schema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    workNumber: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    status: {
      type: String,
      enum: ['draft', 'quotation_sent', 'waiting_advance', 'in_progress', 'completed', 'invoiced', 'archived', 'cancelled'],
      default: 'draft'
    },
    startDate: { type: Date },
    expectedCompletionDate: { type: Date },
    completedDate: { type: Date },
    calculatedTotal: { type: Number, default: 0 },
    manualTotal: { type: Number },
    discountType: { type: String, enum: ['percentage', 'fixed'] },
    discountValue: { type: Number, default: 0 },
    discountedTotal: { type: Number },
    finalAmount: { type: Number, default: 0 },
    totalAdvance: { type: Number, default: 0 },
    remainingBalance: { type: Number, default: 0 },
    notes: { type: String },
    createdBy: { type: String, default: 'admin' },
  },
  { timestamps: true }
);

WorkSchema.index({ customerId: 1, status: 1 });
WorkSchema.index({ status: 1, expectedCompletionDate: 1 });
WorkSchema.index({ workNumber: 1 }, { unique: true });
WorkSchema.index({ createdAt: -1 });

export default mongoose.model<IWork>('Work', WorkSchema);
