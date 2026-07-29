import mongoose from 'mongoose';
import Review from './models/Review';
import { connectDB } from './config/db';

const TESTIMONIALS = [
  { 
    authorName: 'Rajesh Sharma', 
    authorRole: 'Homeowner, Jaipur', 
    content: 'Exceptional quality and craftsmanship. The sliding windows they installed transformed our living room. The team was professional, punctual, and the finish is flawless.', 
    ratingEmoji: '🤩',
    numericValue: 5,
    status: 'APPROVED',
    isFeatured: true
  },
  { 
    authorName: 'Priya Mehta', 
    authorRole: 'Interior Designer', 
    content: 'I recommend Raj Aluminiums for all my projects. Their custom fabrication capabilities are outstanding, and they always deliver on time with perfect precision.', 
    ratingEmoji: '😍',
    numericValue: 5,
    status: 'APPROVED',
    isFeatured: true
  },
  { 
    authorName: 'Anil Gupta', 
    authorRole: 'Builder & Developer', 
    content: 'We have been working with Raj Aluminiums for 8+ years across 50+ projects. Consistent quality, competitive pricing, and reliable after-sales support.', 
    ratingEmoji: '🤩',
    numericValue: 5,
    status: 'APPROVED',
    isFeatured: true
  },
  { 
    authorName: 'Sunita Joshi', 
    authorRole: 'Homeowner, Jodhpur', 
    content: 'The glass partitions they installed in our office are stunning. Beautiful design, soundproof, and installed within a week. Highly recommend their services.', 
    ratingEmoji: '😍',
    numericValue: 5,
    status: 'APPROVED',
    isFeatured: true
  },
];

const seedDB = async () => {
  await connectDB();

  try {
    console.log('Clearing old reviews...');
    await Review.deleteMany({});
    
    console.log('Inserting seed reviews...');
    await Review.insertMany(TESTIMONIALS);
    
    console.log('Database seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
};

seedDB();
