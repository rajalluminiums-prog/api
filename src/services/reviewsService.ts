import Review from '../models/Review';

export const reviewsService = {
  getAggregateStats: async () => {
    const stats = await Review.aggregate([
      { $match: { status: 'APPROVED' } },
      {
        $group: {
          _id: null,
          average: { $avg: '$numericValue' },
          total: { $sum: 1 },
        },
      },
    ]);
    
    if (stats.length === 0) {
      return { average: 0, total: 0 };
    }
    
    return {
      average: Number(stats[0].average.toFixed(1)),
      total: stats[0].total,
    };
  },

  getFeedReviews: async () => {
    const recentReviews = await Review.find({ status: 'APPROVED', numericValue: { $gte: 4 } } as any)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return reviewsService.applyAlgorithm(recentReviews as any[]);
  },

  applyAlgorithm: (recentReviews: any[]) => {
    if (recentReviews.length === 0) return [];
    
    const now = new Date().getTime();

    const weightedReviews = recentReviews.map((review) => {
      let baseScore = review.numericValue * 10;
      
      if (review.content && review.content.length > 50) {
        baseScore += 5; // Length bonus
      }

      if (review.isFeatured) {
        baseScore += 50; // Huge boost for hand-picked
      }
      
      const ageInDays = (now - new Date(review.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      const decayFactor = 1 / (1 + (ageInDays / 30)); // Decays slower to keep good reviews visible longer
      
      const finalScore = baseScore * decayFactor;
      
      return { ...review, _score: finalScore };
    });

    weightedReviews.sort((a, b) => b._score - a._score);
    
    const topPool = weightedReviews.slice(0, 15);
    const shuffled = topPool.sort(() => 0.5 - Math.random());
    
    return shuffled.slice(0, 5).map(({ _score, ...rest }) => rest);
  }
};
