import mongoose, { Schema, Document } from 'mongoose';

export interface IAttachment extends Document {
  workId: mongoose.Types.ObjectId;
  serviceItemId: mongoose.Types.ObjectId;
  imageUrl: string;
  s3Key: string;
  caption?: string;
  uploadedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AttachmentSchema: Schema = new Schema(
  {
    workId: { type: Schema.Types.ObjectId, ref: 'Work', required: true },
    serviceItemId: { type: Schema.Types.ObjectId, ref: 'ServiceItem', required: true },
    imageUrl: { type: String, required: true },
    s3Key: { type: String, required: true, unique: true },
    caption: { type: String },
    uploadedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

AttachmentSchema.index({ workId: 1 });
AttachmentSchema.index({ serviceItemId: 1 });
AttachmentSchema.index({ s3Key: 1 }, { unique: true });

export default mongoose.model<IAttachment>('Attachment', AttachmentSchema);
