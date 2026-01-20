import type { Store, RateRecord, SalesforceMatch } from "@/types/rca";

async function apiRequest<T>(endpoint: string, body: { action: string; params: Record<string, any> }): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || 'Unknown error');
  }

  return data.data;
}

export async function searchStoresByAddress(params: {
  state: string;
  city: string;
  zip: string;
  storeName?: string;
  companyName?: string;
}): Promise<Store[]> {
  const data = await apiRequest<any[]>('/api/stortrack', {
    action: 'findStoresByAddress',
    params: {
      country: 'United States',
      state: params.state,
      city: params.city,
      zip: params.zip,
      storename: params.storeName || '',
      companyname: params.companyName || '',
    },
  });

  return data.map((store: any) => ({
    storeId: store.storeid || store.id,
    masterId: store.masterid,
    storeName: store.storename || store.name || '',
    address: store.address || '',
    city: store.city || '',
    state: store.state || '',
    zip: store.zip || '',
    distance: store.distance || 0,
    latitude: store.latitude,
    longitude: store.longitude,
  }));
}

export async function findCompetitors(params: {
  storeId: number;
  radius: number;
  subjectStoreInfo?: Store; // Pass in subject store info as fallback
}): Promise<{ subject: Store; competitors: Store[] }> {
  const data = await apiRequest<any>('/api/stortrack', {
    action: 'findCompetitors',
    params: {
      storeid: params.storeId,
      coveragezone: params.radius,
    },
  });

  // Handle various API response formats
  const storeData = Array.isArray(data) ? data[0] : data;

  // Build subject store - use API data if available, fallback to passed info
  const subject: Store = {
    storeId: storeData?.storeid || params.storeId,
    masterId: storeData?.masterid,
    storeName: storeData?.storename || params.subjectStoreInfo?.storeName || '',
    address: storeData?.address || params.subjectStoreInfo?.address || '',
    city: storeData?.city || params.subjectStoreInfo?.city || '',
    state: storeData?.state || params.subjectStoreInfo?.state || '',
    zip: storeData?.zip || params.subjectStoreInfo?.zip || '',
    latitude: storeData?.latitude || params.subjectStoreInfo?.latitude,
    longitude: storeData?.longitude || params.subjectStoreInfo?.longitude,
    distance: 0,
  };

  // Get competitors from response - check multiple possible field names
  const competitorsData = storeData?.competitorstores || storeData?.competitors || [];

  const competitors: Store[] = competitorsData
    .filter((comp: any) => {
      // Filter out subject store by ID match
      const compId = comp.storeid || comp.storeId || comp.id;
      return compId !== params.storeId && compId !== storeData?.storeid;
    })
    .map((comp: any) => ({
      storeId: comp.storeid || comp.storeId || comp.id,
      masterId: comp.masterid || comp.masterId,
      storeName: comp.storename || comp.storeName || comp.name || '',
      address: comp.address || '',
      city: comp.city || '',
      state: comp.state || '',
      zip: comp.zip || '',
      latitude: comp.latitude,
      longitude: comp.longitude,
      distance: comp.distance || 0,
    }))
    .sort((a: Store, b: Store) => (a.distance || 0) - (b.distance || 0)); // Sort by distance

  return { subject, competitors };
}

export async function fetchHistoricalData(params: {
  storeId: number;
  fromDate: string;
  toDate: string;
}): Promise<RateRecord[]> {
  const data = await apiRequest<any[]>('/api/stortrack', {
    action: 'fetchHistoricalData',
    params: {
      storeid: params.storeId,
      from: params.fromDate,
      to: params.toDate,
    },
  });

  const records: RateRecord[] = [];

  for (const storeData of data) {
    const rates = storeData.rates || storeData.rateinfo || [];
    for (const rate of rates) {
      records.push({
        storeId: params.storeId,
        storeName: storeData.storename || '',
        address: storeData.address || '',
        city: storeData.city || '',
        state: storeData.state || '',
        zip: storeData.zip || '',
        unitType: rate.spacetype || rate.unittype || '',
        size: rate.size || rate.unitsize || '',
        width: rate.width,
        length: rate.length,
        height: rate.height,
        features: rate.features || '',
        tag: rate.tag || rate.spacetype || '',
        climateControlled: rate.climate_controlled || rate.cc || false,
        humidityControlled: rate.humidity_controlled || false,
        driveUp: rate.drive_up || rate.driveup || false,
        elevator: rate.elevator || false,
        outdoorAccess: rate.outdoor_access || false,
        walkInPrice: rate.regular_rate || rate.regularrate || rate.rate,
        onlinePrice: rate.online_rate || rate.onlinerate,
        date: rate.date_collected || rate.datecollected || rate.date || '',
        promo: rate.promo || rate.promotion || '',
        source: 'API' as const,
      });
    }
  }

  return records;
}

export async function checkMCPHealth(): Promise<{ healthy: boolean; status: number }> {
  return apiRequest('/api/database', { action: 'healthCheck', params: {} });
}

export async function getMCPDatabases(): Promise<any[]> {
  return apiRequest('/api/database', { action: 'getDatabases', params: {} });
}

export async function getMCPSites(params?: { state?: string; city?: string }): Promise<any[]> {
  return apiRequest('/api/database', { action: 'getSites', params: params || {} });
}

export async function queryStortrackData(endpoint: string, queryParams?: Record<string, string>): Promise<any> {
  return apiRequest('/api/database', { action: 'getStortrackData', params: { endpoint, queryParams } });
}

export async function queryMCPDatabase(database: string, table: string, filters?: Record<string, string>, limit?: number): Promise<any> {
  return apiRequest('/api/database', { action: 'queryDatabase', params: { database, table, filters, limit } });
}

export async function getTrailing12MonthRates(params: {
  storeIds: number[];
  fromDate?: string;
  toDate?: string;
}): Promise<{ ratesByStore: Record<number, RateRecord[]>; datesByStore: Record<number, string[]> }> {
  return apiRequest('/api/database', { action: 'getTrailing12MonthRates', params });
}

export async function getSalesforceMetadataByAddress(params: {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  storeName?: string;
}): Promise<{
  yearBuilt: number | null;
  squareFootage: number | null;
  matched: boolean;
  matchScore?: number;
} | null> {
  try {
    const results = await apiRequest<any[]>('/api/database', {
      action: 'getSalesforceMetadataByAddress',
      params
    });

    if (!results || (Array.isArray(results) && results.length === 0)) {
      return null;
    }

    const record = Array.isArray(results) ? results[0] : results;

    let yearBuilt: number | null = null;
    let squareFootage: number | null = null;

    if (record.Year_Built__c) {
      const parsed = parseInt(record.Year_Built__c, 10);
      if (!isNaN(parsed) && parsed >= 1900 && parsed <= 2030) {
        yearBuilt = parsed;
      }
    }

    if (record.Net_RSF__c) {
      const parsed = parseFloat(record.Net_RSF__c);
      if (!isNaN(parsed) && parsed > 0) {
        squareFootage = parsed;
      }
    }

    return {
      yearBuilt,
      squareFootage,
      matched: true,
      matchScore: record.combinedScore,
    };
  } catch (error) {
    console.error('Failed to fetch Salesforce metadata by address:', error);
    return null;
  }
}

export async function getSalesforceMatches(params: {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  storeName?: string;
}): Promise<SalesforceMatch[]> {
  try {
    const results = await apiRequest<SalesforceMatch[]>('/api/database', {
      action: 'getSalesforceMetadataByAddress',
      params
    });

    if (!results || !Array.isArray(results)) {
      return [];
    }

    return results;
  } catch (error) {
    console.error('Failed to fetch Salesforce matches:', error);
    return [];
  }
}

export async function getStoreInfo(storeIds: number[]): Promise<Record<number, {
  storeId: number;
  storeName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}>> {
  return apiRequest('/api/database', { action: 'getStoreInfo', params: { storeIds } });
}

/**
 * Save API-fetched rate records to S3 for later import to database.
 * This is called automatically after fetching historical data from the StorTrack API.
 */
export async function saveRatesToS3(params: {
  rates: RateRecord[];
  metadata?: {
    subjectStoreId?: number;
    analysisId?: string;
    userEmail?: string;
  };
}): Promise<{
  uploaded: boolean;
  filename?: string;
  recordCount?: number;
  s3Path?: string;
  message: string;
  error?: string;
}> {
  try {
    return await apiRequest('/api/database', {
      action: 'saveRatesToS3',
      params
    });
  } catch (error) {
    console.error('Failed to save rates to S3:', error);
    return {
      uploaded: false,
      message: 'Failed to upload rates to S3',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
