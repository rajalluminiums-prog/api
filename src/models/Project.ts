import mongoose from 'mongoose';

const projectSchema = new mongoose.Schema({
  title: { type: String, required: true },
  category: { type: String, required: true, index: true },
  type: { type: String, required: true },
  dims: { type: String, required: true },
  altText: { type: String, required: true },
  s3Key: { type: String, required: true, unique: true },
  imageUrl: { type: String, required: true },
  gridSpan: { type: String, enum: ['standard', 'wide', 'tall', 'large'], default: 'standard' },
  isVisible: { type: Boolean, default: true, index: true },
  displayOrder: { type: Number, default: 0, index: true },
  location: {
    type: { type: String, enum: ['Point'] },
    coordinates: { type: [Number] }, // [longitude, latitude]
    accuracy: { type: Number },
    capturedAt: { type: Date }
  },
  linkedWorkId: { type: mongoose.Schema.Types.ObjectId, ref: 'Work', index: true },
  linkedServiceItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceItem', index: true }
}, { timestamps: true });

// Compound index for efficient paginated category fetching
projectSchema.index({ isVisible: 1, category: 1, displayOrder: -1, createdAt: -1 });
projectSchema.index({ location: "2dsphere" });
projectSchema.index({ linkedServiceItemId: 1 });

export const Project = mongoose.model('Project', projectSchema);
