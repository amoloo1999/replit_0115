// RCA Tool Type Definitions

export interface SearchCriteria {
  streetAddress: string;
  country: string;
  state: string;
  city: string;
  zipCode: string;
  storeName: string;
  companyName: string;
  radius: number;
}

export interface Store {
  storeId: number;
  masterId?: number;
  storeName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone?: string;
  latitude?: number;
  longitude?: number;
  storeStatus?: number;
  distance?: number;
}

export interface StoreMetadata {
  yearBuilt: number | null;
  squareFootage: number | null;
  distance?: number;
  salesforceMatch?: SalesforceMatch | null;
}

// Salesforce match from fuzzy matching (like RCA_template.py)
export interface SalesforceMatch {
  Name: string;
  Year_Built__c: string | number | null;
  Net_RSF__c: string | number | null;
  ShippingAddress: string | null;
  nameScore: number;
  addressScore: number;
  combinedScore: number;
  parsedStoreName: string;
  parsedAddress: string;
}

export interface StoreRankings {
  Location: number;
  Age: number;
  Accessibility: number;
  VPD: number;
  'Visibility & Signage': number;
  Brand: number;
  Quality: number;
  Size: number;
}

export interface AdjustmentFactors {
  captiveMarketPremium: number;
  lossToLease: number;
  ccAdj: number;
}

export interface DateGap {
  storeId: number;
  storeName: string;
  missingDays: number;
  coveragePercent: number;
  dateRanges: string[];
  yearsNeeded: number[];
  estimatedCost: number;
}

export interface FeatureCode {
  originalTag: string;
  code: string;
  count: number;
}

export interface RateRecord {
  storeId: number;
  storeName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  distance?: number;
  unitType: string;
  size: string;
  width?: number;
  length?: number;
  height?: number;
  features: string;
  tag: string;
  climateControlled: boolean;
  humidityControlled: boolean;
  driveUp: boolean;
  elevator: boolean;
  outdoorAccess: boolean;
  walkInPrice?: number;
  onlinePrice?: number;
  pctDifference?: number;
  date: string;
  promo: string;
  source: 'Database' | 'API';
}

export interface WizardStep {
  id: number;
  name: string;
  description: string;
  completed: boolean;
}

export type FeatureCodeType = 
  | 'GLCC'  // Ground Level Climate Controlled
  | 'GNCC'  // Ground Level Non-Climate Controlled
  | 'ECC'   // Elevator Climate Controlled
  | 'ENCC'  // Elevator Non-Climate Controlled
  | 'DUCC'  // Drive-Up Climate Controlled
  | 'DU'    // Drive-Up (Non-Climate)
  | 'ICC'   // Interior Climate Controlled
  | 'INCC'  // Interior Non-Climate Controlled
  | 'CC'    // Climate Controlled (generic)
  | 'NCC'   // Non-Climate Controlled (generic)
  | string; // Custom code
