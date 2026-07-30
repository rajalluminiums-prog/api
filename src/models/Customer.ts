import mongoose, { Schema, Document } from 'mongoose';

export interface ICustomer extends Document {
  name: string;
  mobile: string;
  email?: string;
  address?: string;
  notes?: string;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    mobile: { type: String, required: true, unique: true },
    email: { type: String },
    address: { type: String },
    notes: { type: String },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String, default: 'admin' },
  },
  { timestamps: true }
);

CustomerSchema.index({ mobile: 1 }, { unique: true });
CustomerSchema.index({ name: 'text' });
CustomerSchema.index({ isActive: 1, createdAt: -1 });

export default mongoose.model<ICustomer>('Customer', CustomerSchema);
