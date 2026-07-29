import mongoose from 'mongoose';

export const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/ra-portfolio';
    await mongoose.connect(uri);
    console.log(`MongoDB Connected: ${mongoose.connection.host}`);
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    process.exit(1);
  }
};
