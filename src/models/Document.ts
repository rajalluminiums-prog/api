import mongoose, { Schema, Document } from 'mongoose';

export interface IDoc extends Document {
  workId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  documentType: 'quotation' | 'invoice';
  documentNumber: string;
  generatedAt: Date;
  snapshotData: any;
  pdfS3Key?: string;
  pdfUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DocumentSchema: Schema = new Schema(
  {
    workId: { type: Schema.Types.ObjectId, ref: 'Work', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    documentType: { type: String, enum: ['quotation', 'invoice'], required: true },
    documentNumber: { type: String, required: true, unique: true },
    generatedAt: { type: Date, default: Date.now },
    snapshotData: { type: Schema.Types.Mixed, required: true },
    pdfS3Key: { type: String },
    pdfUrl: { type: String },
  },
  { timestamps: true }
);

DocumentSchema.index({ workId: 1, documentType: 1 });
DocumentSchema.index({ documentNumber: 1 }, { unique: true });

// Avoid conflict with global Document by importing mongoose.Document as something else or just passing IDoc
export default mongoose.model<IDoc>('Document', DocumentSchema);
