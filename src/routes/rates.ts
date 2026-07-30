import { Hono } from 'hono';
import ProductRate from '../models/ProductRate';

const ratesRouter = new Hono();

// Get all rates (Admin Panel)
ratesRouter.get('/', async (c) => {
  try {
    const rates = await ProductRate.find().sort({ category: 1, createdAt: -1 });
    return c.json({ success: true, data: rates });
  } catch (error) {
    return c.json({ success: false, error: 'Failed to fetch rates' }, 500);
  }
});

// Create a new rate
ratesRouter.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const rate = new ProductRate(body);
    await rate.save();
    return c.json({ success: true, data: rate }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message || 'Failed to create rate' }, 400);
  }
});

// Update a rate
ratesRouter.put('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const rate = await ProductRate.findByIdAndUpdate(id, body, { new: true });
    if (!rate) return c.json({ success: false, error: 'Rate not found' }, 404);
    return c.json({ success: true, data: rate });
  } catch (error) {
    return c.json({ success: false, error: 'Failed to update rate' }, 400);
  }
});

// Delete a rate
ratesRouter.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const rate = await ProductRate.findByIdAndDelete(id);
    if (!rate) return c.json({ success: false, error: 'Rate not found' }, 404);
    return c.json({ success: true, message: 'Rate deleted successfully' });
  } catch (error) {
    return c.json({ success: false, error: 'Failed to delete rate' }, 400);
  }
});

// Helper for accurate math conversion
const convertToSqFt = (feet: number, inches: number) => {
  const totalFeet = (Number(feet) || 0) + (Number(inches) || 0) / 12;
  return totalFeet;
};

// Calculate Quote
ratesRouter.post('/calculate', async (c) => {
  try {
    const body = await c.req.json();
    const { category, attributes, dimensions } = body;
    
    // dimensions expected: { widthFeet: number, widthInches: number, heightFeet: number, heightInches: number }
    if (!category || !dimensions) {
      return c.json({ success: false, error: 'Missing required fields' }, 400);
    }

    const widthSqFt = convertToSqFt(dimensions.widthFeet, dimensions.widthInches);
    const heightSqFt = convertToSqFt(dimensions.heightFeet, dimensions.heightInches);
    const totalAreaSqFt = widthSqFt * heightSqFt;

    if (totalAreaSqFt <= 0) {
      return c.json({ success: false, error: 'Invalid dimensions' }, 400);
    }

    // Normalize category to handle 'Window' vs 'Windows'
    const singularCategory = category.endsWith('s') ? category.slice(0, -1) : category;
    const pluralCategory = singularCategory + 's';

    // Find applicable pricing rule
    const allCategoryRates = await ProductRate.find({ 
      category: { $in: [category, singularCategory, pluralCategory] },
      isActive: true 
    });
    
    let matchedRate = null;
    
    if (category === 'Fix') {
       // 'Fix' usually just has a base price without attributes
       matchedRate = allCategoryRates[0]; 
    } else {
       // Match attributes case-insensitively
       matchedRate = allCategoryRates.find(rate => {
         const rateAttrs = rate.get('attributes') ? Object.fromEntries((rate as any).attributes) : {};
         const requestAttrs = attributes || {};
         
         // Normalize keys to lowercase for robust matching
         const normRateAttrs: Record<string, string> = {};
         for (const [k, v] of Object.entries(rateAttrs)) {
             normRateAttrs[k.toLowerCase()] = String(v).toLowerCase();
         }
         
         const normReqAttrs: Record<string, string> = {};
         for (const [k, v] of Object.entries(requestAttrs)) {
             normReqAttrs[k.toLowerCase()] = String(v).toLowerCase();
         }
         
         // Check if all requested attributes match the rate's attributes
         for (const [key, val] of Object.entries(normReqAttrs)) {
           if (normRateAttrs[key] !== val) return false;
         }
         
         // Exact key count match to prevent partial matching
         if (Object.keys(normRateAttrs).length !== Object.keys(normReqAttrs).length) return false;
         
         return true;
       });
    }

    if (!matchedRate) {
      return c.json({ success: false, error: 'No pricing configuration found for these exact specifications' });
    }

    const pricePerSqFt = matchedRate.pricePerSqFt;
    const minStandardSqft = matchedRate.minStandardSqft || 0;
    const fixedPriceUnderStandard = matchedRate.fixedPriceUnderStandard || 0;

    let estimatedTotal = 0;
    let pricingType = 'Per SqFt';

    if (minStandardSqft > 0 && totalAreaSqFt < minStandardSqft) {
      estimatedTotal = fixedPriceUnderStandard;
      pricingType = 'Fixed';
    } else {
      // Standard rounding to 2 decimal places to avoid float cumulative errors
      estimatedTotal = Math.round((totalAreaSqFt * pricePerSqFt) * 100) / 100;
    }

    return c.json({
      success: true,
      data: {
        areaSqFt: Math.round(totalAreaSqFt * 100) / 100,
        pricePerSqFt,
        estimatedTotal,
        pricingType
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message || 'Failed to calculate quote' }, 500);
  }
});

export const ratesRouterExport = ratesRouter;
