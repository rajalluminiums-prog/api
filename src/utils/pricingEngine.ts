import ProductRate from '../models/ProductRate';
import Work, { IWork } from '../models/Work';
import ServiceItem, { IServiceItem } from '../models/ServiceItem';

const convertToSqFt = (feet: number, inches: number) => {
  return (Number(feet) || 0) + (Number(inches) || 0) / 12;
};

const categoryMap: Record<string, string> = {
  'Windows': 'Window',
  'Doors': 'Door',
  'Partitions': 'Partition',
  'Fix': 'Fix'
};

export async function calculateItemPricing(
  serviceCategory: string,
  configuration: Record<string, string>,
  sizeEntries: Array<{ widthFeet: number; widthInches: number; heightFeet: number; heightInches: number; manualPrice?: number | null; quantity: number }>
): Promise<Array<{ areaSqFt: number; ratePerSqFt: number; pricingType: 'Per SqFt' | 'Fixed'; calculatedPrice: number; manualPrice: number | null; effectivePrice: number; lineTotal: number; quantity: number; widthFeet: number; widthInches: number; heightFeet: number; heightInches: number }>> {
  
  const singularCategory = serviceCategory.endsWith('s') ? serviceCategory.slice(0, -1) : serviceCategory;
  const pluralCategory = singularCategory + 's';

  const allCategoryRates = await ProductRate.find({ 
    category: { $in: [serviceCategory, singularCategory, pluralCategory] }, 
    isActive: true 
  });
  
  let matchedRate = null;
  if (serviceCategory === 'Fix') {
     matchedRate = allCategoryRates[0]; 
  } else {
     matchedRate = allCategoryRates.find(rate => {
       const rateAttrs = rate.get('attributes') ? Object.fromEntries((rate as any).attributes) : {};
       const requestAttrs = configuration || {};
       
       const normRateAttrs: Record<string, string> = {};
       for (const [k, v] of Object.entries(rateAttrs)) {
           normRateAttrs[k.toLowerCase()] = String(v).toLowerCase();
       }
       
       const normReqAttrs: Record<string, string> = {};
       for (const [k, v] of Object.entries(requestAttrs)) {
           normReqAttrs[k.toLowerCase()] = String(v).toLowerCase();
       }
       
       for (const [key, val] of Object.entries(normReqAttrs)) {
         if (normRateAttrs[key] !== val) return false;
       }
       
       if (Object.keys(normRateAttrs).length !== Object.keys(normReqAttrs).length) return false;
       
       return true;
     });
  }

  const result = [];
  
  for (const entry of sizeEntries) {
    const widthSqFt = convertToSqFt(entry.widthFeet, entry.widthInches);
    const heightSqFt = convertToSqFt(entry.heightFeet, entry.heightInches);
    const totalAreaSqFt = widthSqFt * heightSqFt;
    
    let calculatedPrice = 0;
    let ratePerSqFt = 0;
    let pricingType: 'Per SqFt' | 'Fixed' = 'Per SqFt';
    
    if (matchedRate) {
      ratePerSqFt = matchedRate.pricePerSqFt;
      const minStandardSqft = matchedRate.minStandardSqft || 0;
      const fixedPriceUnderStandard = matchedRate.fixedPriceUnderStandard || 0;
      
      if (minStandardSqft > 0 && totalAreaSqFt < minStandardSqft) {
        calculatedPrice = fixedPriceUnderStandard;
        pricingType = 'Fixed';
      } else {
        calculatedPrice = Math.round((totalAreaSqFt * ratePerSqFt) * 100) / 100;
      }
    }
    
    const manualPrice = entry.manualPrice ?? null;
    const effectivePrice = manualPrice !== null ? manualPrice : calculatedPrice;
    const lineTotal = effectivePrice * entry.quantity;
    
    result.push({
      widthFeet: entry.widthFeet,
      widthInches: entry.widthInches,
      heightFeet: entry.heightFeet,
      heightInches: entry.heightInches,
      areaSqFt: Math.round(totalAreaSqFt * 100) / 100,
      ratePerSqFt,
      pricingType,
      calculatedPrice,
      manualPrice,
      effectivePrice,
      quantity: entry.quantity,
      lineTotal
    });
  }
  
  return result;
}

export function recalculateWorkTotals(work: any, items: any[]): { calculatedTotal: number; finalAmount: number; remainingBalance: number; discountedTotal: number | null } {
  let calculatedTotal = 0;
  
  for (const item of items) {
    calculatedTotal += item.effectiveTotalPrice || 0;
  }
  
  const baseTotal = work.manualTotal !== undefined && work.manualTotal !== null ? work.manualTotal : calculatedTotal;
  
  let discountAmount = 0;
  if (work.discountType === 'percentage' && work.discountValue) {
    discountAmount = (baseTotal * work.discountValue) / 100;
  } else if (work.discountType === 'fixed' && work.discountValue) {
    discountAmount = work.discountValue;
  }
  
  const finalAmount = Math.max(0, baseTotal - discountAmount);
  const remainingBalance = Math.max(0, finalAmount - (work.totalAdvance || 0));
  
  return {
    calculatedTotal,
    discountedTotal: discountAmount > 0 ? finalAmount : null,
    finalAmount,
    remainingBalance
  };
}
