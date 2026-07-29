import mongoose, { Schema, Document } from 'mongoose';

export interface IReview extends Document {
  authorName: string;
  authorRole?: string;
  content: string;
  ratingEmoji: string;
  numericValue: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  isFeatured: boolean;
  spamScore: number;
  ipHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ReviewSchema: Schema = new Schema(
  {
    authorName: { type: String, required: true, maxlength: 50 },
    authorRole: { type: String, maxlength: 50 },
    content: { type: String, required: true, maxlength: 500 },
    ratingEmoji: { 
      type: String, 
      required: true, 
      enum: ['🤩', '😍', '😊', '😐', '😞'] 
    },
    numericValue: { type: Number, required: true, min: 1, max: 5 },
    status: { 
      type: String, 
      enum: ['PENDING', 'APPROVED', 'REJECTED'], 
      default: 'PENDING' 
    },
    isFeatured: { type: Boolean, default: false },
    spamScore: { type: Number, default: 0 },
    ipHash: { type: String, select: false },
  },
  { timestamps: true }
);

// Indexes mapped from the implementation plan
ReviewSchema.index({ status: 1, numericValue: -1, createdAt: -1 });
ReviewSchema.index({ isFeatured: 1 });
ReviewSchema.index({ ipHash: 1 });

export default mongoose.models.Review || mongoose.model<IReview>('Review', ReviewSchema);
