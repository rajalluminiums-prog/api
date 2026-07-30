import mongoose, { Schema, Document } from 'mongoose';

export interface IPayment extends Document {
  workId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  amount: number;
  paymentType: 'advance' | 'partial' | 'final';
  paymentMethod: 'cash' | 'upi' | 'bank_transfer' | 'other';
  notes?: string;
  receivedDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema: Schema = new Schema(
  {
    workId: { type: Schema.Types.ObjectId, ref: 'Work', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    amount: { type: Number, required: true, min: 0 },
    paymentType: { type: String, enum: ['advance', 'partial', 'final'], required: true },
    paymentMethod: { type: String, enum: ['cash', 'upi', 'bank_transfer', 'other'], default: 'cash' },
    notes: { type: String },
    receivedDate: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

PaymentSchema.index({ workId: 1, receivedDate: -1 });
PaymentSchema.index({ customerId: 1 });
PaymentSchema.index({ receivedDate: -1 });

export default mongoose.model<IPayment>('Payment', PaymentSchema);
