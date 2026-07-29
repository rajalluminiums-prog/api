import mongoose from 'mongoose';

const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true } // Storing plain text as requested for this specific simple implementation
}, { timestamps: true });

export const Admin = mongoose.model('Admin', adminSchema);
