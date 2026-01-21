import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import type {
  SearchCriteria,
  Store,
  StoreMetadata,
  StoreRankings,
  AdjustmentFactors,
  DateGap,
  FeatureCode,
  RateRecord,
  WizardStep,
  SalesforceMatch,
} from '@/types/rca';
import {
  searchStoresByAddress,
  findCompetitors,
  fetchHistoricalData,
  getTrailing12MonthRates,
  getSalesforceMetadataByAddress,
  getSalesforceMatches,
  saveRatesToS3,
} from '@/lib/api';

// Storage key for session persistence
const STORAGE_KEY = 'rca_wizard_state';

export interface RCAWizardState {
  currentStep: number;
  searchCriteria: SearchCriteria;
  searchResults: Store[];
  subjectStore: Store | null;
  competitors: Store[];
  selectedStores: Store[];
  storeMetadata: Record<number, StoreMetadata>;
  storeRankings: Record<number, StoreRankings>;
  adjustmentFactors: AdjustmentFactors;
  customNames: Record<number, string>;
  dateGaps: DateGap[];
  apiStoreIds: number[];
  featureCodes: FeatureCode[];
  rateRecords: RateRecord[];
  isLoading: boolean;
  error: string | null;
}

const initialSearchCriteria: SearchCriteria = {
  streetAddress: '',
  country: 'United States',
  state: '',
  city: '',
  zipCode: '',
  storeName: '',
  companyName: '',
  radius: 5,
};

const initialAdjustmentFactors: AdjustmentFactors = {
  captiveMarketPremium: 0,
  lossToLease: 0,
  ccAdj: 0,
};

const defaultRankings: StoreRankings = {
  Location: 5,
  Age: 5,
  Accessibility: 5,
  VPD: 5,
  'Visibility & Signage': 5,
  Brand: 5,
  Quality: 5,
  Size: 5,
};

export const WIZARD_STEPS: WizardStep[] = [
  { id: 1, name: 'Search', description: 'Enter address to find stores', completed: false },
  { id: 2, name: 'Subject Store', description: 'Select subject store', completed: false },
  { id: 3, name: 'Competitors', description: 'View and select competitors', completed: false },
  { id: 4, name: 'Metadata', description: 'Enter Year Built & SF', completed: false },
  { id: 5, name: 'Rankings', description: 'Rate store attributes', completed: false },
  { id: 6, name: 'Adjustments', description: 'Set adjustment factors', completed: false },
  { id: 7, name: 'Names', description: 'Customize store names', completed: false },
  { id: 8, name: 'Data Gaps', description: 'Review database coverage', completed: false },
  { id: 9, name: 'Feature Codes', description: 'Assign unit codes', completed: false },
  { id: 10, name: 'Data Visualization', description: 'View and export data', completed: false },
];

// Helper to load state from localStorage
function loadPersistedState(): Partial<RCAWizardState> | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Don't restore loading state
      return { ...parsed, isLoading: false, error: null };
    }
  } catch (e) {
    console.warn('Failed to load persisted RCA state:', e);
  }
  return null;
}

// Helper to save state to localStorage
function persistState(state: RCAWizardState) {
  try {
    // Don't persist loading/error state
    const toSave = { ...state, isLoading: false, error: null };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.warn('Failed to persist RCA state:', e);
  }
}

// Helper to clear persisted state
function clearPersistedState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear persisted RCA state:', e);
  }
}

export function useRCAWizard() {
  // Try to restore from localStorage on initial load
  const initialState: RCAWizardState = {
    currentStep: 1,
    searchCriteria: initialSearchCriteria,
    searchResults: [],
    subjectStore: null,
    competitors: [],
    selectedStores: [],
    storeMetadata: {},
    storeRankings: {},
    adjustmentFactors: initialAdjustmentFactors,
    customNames: {},
    dateGaps: [],
    apiStoreIds: [],
    featureCodes: [],
    rateRecords: [],
    isLoading: false,
    error: null,
  };

  const [state, setState] = useState<RCAWizardState>(() => {
    const persisted = loadPersistedState();
    if (persisted && persisted.currentStep && persisted.currentStep > 1) {
      // Only restore if we had meaningful progress
      return { ...initialState, ...persisted };
    }
    return initialState;
  });

  // Persist state whenever it changes (debounced effect)
  useEffect(() => {
    // Only persist if we have meaningful progress
    if (state.currentStep > 1 || state.searchResults.length > 0) {
      const timeoutId = setTimeout(() => persistState(state), 500);
      return () => clearTimeout(timeoutId);
    }
  }, [state]);

  const setStep = useCallback((step: number) => {
    setState((prev) => ({ ...prev, currentStep: step }));
  }, []);

  const nextStep = useCallback(() => {
    setState((prev) => ({
      ...prev,
      currentStep: Math.min(prev.currentStep + 1, WIZARD_STEPS.length),
    }));
  }, []);

  const prevStep = useCallback(() => {
    setState((prev) => ({
      ...prev,
      currentStep: Math.max(prev.currentStep - 1, 1),
    }));
  }, []);

  const updateSearchCriteria = useCallback((criteria: Partial<SearchCriteria>) => {
    setState((prev) => ({
      ...prev,
      searchCriteria: { ...prev.searchCriteria, ...criteria },
    }));
  }, []);

  // Real API call to search stores
  const searchStores = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const { state: currentState } = state.searchCriteria;
      const stores = await searchStoresByAddress({
        state: state.searchCriteria.state,
        city: state.searchCriteria.city,
        zip: state.searchCriteria.zipCode,
        storeName: state.searchCriteria.storeName,
        companyName: state.searchCriteria.companyName,
      });

      setState((prev) => ({
        ...prev,
        isLoading: false,
        searchResults: stores,
        error: null,
      }));

      toast.success(`Found ${stores.length} stores`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to search stores';
      console.error('Search error:', error);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: message,
        searchResults: [],
      }));
      toast.error(message);
    }
  }, [state.searchCriteria]);

  // Select subject store and fetch competitors from API
  const selectSubjectStore = useCallback(async (store: Store) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const result = await findCompetitors({
        storeId: store.storeId,
        radius: state.searchCriteria.radius,
        subjectStoreInfo: store, // Pass store info as fallback
      });

      setState((prev) => ({
        ...prev,
        isLoading: false,
        subjectStore: { ...result.subject, distance: 0 },
        competitors: result.competitors,
        error: null,
      }));

      toast.success(`Found ${result.competitors.length} competitors`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to find competitors';
      console.error('Competitor search error:', error);

      // Fall back to using search results as competitors
      setState((prev) => {
        const competitors = prev.searchResults
          .filter((s) => s.storeId !== store.storeId)
          .sort((a, b) => (a.distance || 0) - (b.distance || 0));

        return {
          ...prev,
          isLoading: false,
          subjectStore: { ...store, distance: 0 },
          competitors,
          error: null,
        };
      });

      toast.warning('Using search results as competitors');
    }
  }, [state.searchCriteria.radius]);

  const selectStoresForAnalysis = useCallback(async (stores: Store[]) => {
    setState((prev) => ({ ...prev, isLoading: true }));

    const selected = state.subjectStore ? [state.subjectStore, ...stores] : stores;
    const metadata: Record<number, StoreMetadata> = {};
    const rankings: Record<number, StoreRankings> = {};
    const customNames: Record<number, string> = {};

    // Initialize with empty metadata
    selected.forEach((store) => {
      metadata[store.storeId] = { yearBuilt: null, squareFootage: null, distance: store.distance };
      rankings[store.storeId] = { ...defaultRankings };
      customNames[store.storeId] = store.storeName;
    });

    // Fetch metadata from Salesforce_rawData for each store by matching address and name
    // Uses fuzzy matching logic like RCA_template.py
    const metadataPromises = selected.map(async (store) => {
      try {
        const result = await getSalesforceMetadataByAddress({
          street: store.address,
          city: store.city,
          state: store.state,
          postalCode: store.zip,
          storeName: store.storeName,
        });

        if (result && result.matched) {
          metadata[store.storeId] = {
            ...metadata[store.storeId],
            yearBuilt: result.yearBuilt,
            squareFootage: result.squareFootage,
          };
        }
      } catch (error) {
        console.warn(`Failed to fetch metadata for store ${store.storeId}:`, error);
      }
    });

    await Promise.all(metadataPromises);

    setState((prev) => ({
      ...prev,
      selectedStores: selected,
      storeMetadata: metadata,
      storeRankings: rankings,
      customNames,
      // Clear stale data from previous analysis when new stores are selected
      dateGaps: [],
      featureCodes: [],
      rateRecords: [],
      isLoading: false,
    }));

    const matchedCount = Object.values(metadata).filter(m => m.yearBuilt || m.squareFootage).length;
    if (matchedCount > 0) {
      toast.success(`Found metadata for ${matchedCount} of ${selected.length} stores`);
    }
  }, [state.subjectStore]);

  // Try to fetch metadata from Salesforce via MCP by address and name
  // Uses fuzzy matching logic like RCA_template.py
  const fetchStoreMetadata = useCallback(async (store: Store) => {
    try {
      const result = await getSalesforceMetadataByAddress({
        street: store.address,
        city: store.city,
        state: store.state,
        postalCode: store.zip,
        storeName: store.storeName,
      });

      if (result && result.matched) {
        setState((prev) => ({
          ...prev,
          storeMetadata: {
            ...prev.storeMetadata,
            [store.storeId]: {
              ...prev.storeMetadata[store.storeId],
              yearBuilt: result.yearBuilt,
              squareFootage: result.squareFootage,
            },
          },
        }));
        return result;
      }
    } catch (error) {
      console.error('Failed to fetch Salesforce metadata:', error);
    }
    return null;
  }, []);

  // Fetch all Salesforce matches for a store so user can select the correct one
  // Like RCA_template.py prompt_for_salesforce_match
  const fetchSalesforceMatchesForStore = useCallback(async (store: Store): Promise<SalesforceMatch[]> => {
    try {
      const matches = await getSalesforceMatches({
        street: store.address,
        city: store.city,
        state: store.state,
        postalCode: store.zip,
        storeName: store.storeName,
      });
      return matches;
    } catch (error) {
      console.error('Failed to fetch Salesforce matches:', error);
      return [];
    }
  }, []);

  const updateStoreMetadata = useCallback((storeId: number, metadata: Partial<StoreMetadata>) => {
    setState((prev) => ({
      ...prev,
      storeMetadata: {
        ...prev.storeMetadata,
        [storeId]: { ...prev.storeMetadata[storeId], ...metadata },
      },
    }));
  }, []);

  const updateStoreRankings = useCallback((storeId: number, rankings: Partial<StoreRankings>) => {
    setState((prev) => ({
      ...prev,
      storeRankings: {
        ...prev.storeRankings,
        [storeId]: { ...prev.storeRankings[storeId], ...rankings },
      },
    }));
  }, []);

  const updateAdjustmentFactors = useCallback((factors: Partial<AdjustmentFactors>) => {
    setState((prev) => ({
      ...prev,
      adjustmentFactors: { ...prev.adjustmentFactors, ...factors },
    }));
  }, []);

  const updateCustomName = useCallback((storeId: number, name: string) => {
    setState((prev) => ({
      ...prev,
      customNames: { ...prev.customNames, [storeId]: name },
    }));
  }, []);

  // Analyze data gaps using real API
  const analyzeGaps = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const storeIds = state.selectedStores.map((s) => s.storeId);
      const result = await getTrailing12MonthRates({ storeIds });

      // Calculate gaps based on actual data coverage
      const gaps: DateGap[] = state.selectedStores.map((store) => {
        const dates = result.datesByStore[store.storeId] || [];
        const totalExpectedDays = 365;
        const actualDays = dates.length;
        const missingDays = Math.max(0, totalExpectedDays - actualDays);

        // Cost is $12.50 for a full year, prorated by missing days: (missingDays / 365) * 12.50
        const estimatedCost = missingDays > 0 ? (missingDays / 365) * 12.5 : 0;

        return {
          storeId: store.storeId,
          storeName: store.storeName,
          missingDays,
          coveragePercent: Math.round((actualDays / totalExpectedDays) * 100 * 10) / 10,
          dateRanges: [], // Would need more detailed analysis
          yearsNeeded: missingDays > 30 ? [2024, 2025] : [],
          estimatedCost,
        };
      });

      setState((prev) => ({
        ...prev,
        isLoading: false,
        dateGaps: gaps,
        error: null,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to analyze gaps';
      console.error('Gap analysis error:', error);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: message,
        dateGaps: [],
      }));
      toast.error(message);
    }
  }, [state.selectedStores]);

  const setApiStoreIds = useCallback((ids: number[]) => {
    setState((prev) => ({ ...prev, apiStoreIds: ids }));
  }, []);

  // Fill data gaps by fetching historical data from StorTrack API
  // This is the key function that calls the paid API to fill missing rate data
  const fillDataGaps = useCallback(async (
    onProgress?: (current: number, total: number, storeName: string) => void
  ): Promise<{ success: boolean; recordsFetched: number; errors: string[] }> => {
    const storeIdsToFetch = state.apiStoreIds;

    if (storeIdsToFetch.length === 0) {
      toast.error('No stores selected for API fetch');
      return { success: false, recordsFetched: 0, errors: ['No stores selected'] };
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    const errors: string[] = [];
    const allApiRecords: RateRecord[] = [];

    // Calculate date range - trailing 12 months
    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setMonth(fromDate.getMonth() - 12);
    const fromDateStr = fromDate.toISOString().split('T')[0];
    const toDateStr = today.toISOString().split('T')[0];

    console.log(`fillDataGaps: Fetching data for ${storeIdsToFetch.length} stores from ${fromDateStr} to ${toDateStr}`);

    for (let i = 0; i < storeIdsToFetch.length; i++) {
      const storeId = storeIdsToFetch[i];
      const store = state.selectedStores.find((s: Store) => s.storeId === storeId);
      const storeName = store?.storeName || `Store ${storeId}`;

      // Report progress
      if (onProgress) {
        onProgress(i + 1, storeIdsToFetch.length, storeName);
      }

      try {
        console.log(`fillDataGaps: Fetching historical data for store ${storeId} (${storeName})`);

        const records = await fetchHistoricalData({
          storeId,
          fromDate: fromDateStr,
          toDate: toDateStr,
        });

        console.log(`fillDataGaps: Got ${records.length} records for store ${storeId}`);

        // Mark records as from API
        const markedRecords = records.map((r) => ({
          ...r,
          source: 'API' as const,
        }));

        allApiRecords.push(...markedRecords);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`fillDataGaps: Error fetching store ${storeId}:`, errorMsg);
        errors.push(`${storeName}: ${errorMsg}`);
      }
    }

    console.log(`fillDataGaps: Total API records fetched: ${allApiRecords.length}`);

    // Save API-fetched records to S3 for database import
    if (allApiRecords.length > 0) {
      try {
        const s3Result = await saveRatesToS3({
          rates: allApiRecords,
          metadata: {
            subjectStoreId: state.subjectStore?.storeId,
            analysisId: `rca-gaps-${Date.now()}`,
          },
        });

        if (s3Result.uploaded) {
          console.log(`fillDataGaps: Saved ${s3Result.recordCount} records to S3: ${s3Result.s3Path}`);
          toast.success(`Saved ${s3Result.recordCount} records to S3 for database import`);
        } else {
          console.warn('fillDataGaps: Failed to save to S3:', s3Result.message);
        }
      } catch (s3Error) {
        console.warn('fillDataGaps: S3 save error:', s3Error);
      }
    }

    // Merge API records with existing DB records
    // Get existing DB records and add new API records
    const existingRecords = state.rateRecords.filter((r: RateRecord) => r.source === 'Database');
    const mergedRecords = [...existingRecords, ...allApiRecords];

    // Remove duplicates (same store, size, date)
    const uniqueRecords: RateRecord[] = [];
    const seenKeys = new Set<string>();

    for (const record of mergedRecords) {
      const key = `${record.storeId}-${record.size}-${record.date}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueRecords.push(record);
      }
    }

    // Update state with merged records and clear the gaps for fetched stores
    setState((prev) => {
      // Update gaps - mark fetched stores as having 0 missing days
      const updatedGaps = prev.dateGaps.map((gap: DateGap) => {
        if (storeIdsToFetch.includes(gap.storeId)) {
          return {
            ...gap,
            missingDays: 0,
            coveragePercent: 100,
            dateRanges: [],
          };
        }
        return gap;
      });

      return {
        ...prev,
        isLoading: false,
        rateRecords: uniqueRecords,
        dateGaps: updatedGaps,
        apiStoreIds: [], // Clear selection after fetch
        error: errors.length > 0 ? `Completed with ${errors.length} errors` : null,
      };
    });

    if (allApiRecords.length > 0) {
      toast.success(`Fetched ${allApiRecords.length} records from StorTrack API`);
    }

    if (errors.length > 0) {
      toast.warning(`${errors.length} store(s) had errors during fetch`);
    }

    return {
      success: errors.length === 0,
      recordsFetched: allApiRecords.length,
      errors,
    };
  }, [state.apiStoreIds, state.selectedStores, state.rateRecords, state.subjectStore, state.dateGaps]);

  const updateFeatureCode = useCallback((tag: string, code: string) => {
    setState((prev) => ({
      ...prev,
      featureCodes: prev.featureCodes.map((fc) =>
        fc.originalTag === tag ? { ...fc, code } : fc
      ),
    }));
  }, []);

  // Initialize feature codes from actual rate data
  // Uses BOTH database records AND any API-fetched historical data
  const initializeFeatureCodes = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      const storeIds = state.selectedStores.map((s) => s.storeId);

      // Start with any existing API-fetched records we already have
      let allRecords: RateRecord[] = [...state.rateRecords];
      console.log(`initializeFeatureCodes: Starting with ${allRecords.length} existing records (from API/previous fetches)`);

      // Also fetch from database to ensure we have complete coverage
      const result = await getTrailing12MonthRates({ storeIds });

      // Collect database records
      const dbRecords: RateRecord[] = [];
      for (const storeId of storeIds) {
        const storeRecords = result.ratesByStore[storeId] || result.ratesByStore[String(storeId)] || [];
        dbRecords.push(...storeRecords);
      }
      console.log(`initializeFeatureCodes: Fetched ${dbRecords.length} records from database`);

      // Merge: API records take precedence, add DB records that don't exist in API set
      // Build a set of keys from existing records for deduplication
      const existingKeys = new Set(allRecords.map((r) => `${r.storeId}-${r.size}-${r.date}`));

      // Add DB records that aren't already in our set
      for (const record of dbRecords) {
        const key = `${record.storeId}-${record.size}-${record.date}`;
        if (!existingKeys.has(key)) {
          allRecords.push(record);
          existingKeys.add(key);
        }
      }

      console.log(`initializeFeatureCodes: Total merged records: ${allRecords.length}`);

      // Extract unique tags and count occurrences
      // Build tag from features similar to RCA_script.py build_tag_from_db_fields
      const tagCounts: Record<string, number> = {};
      allRecords.forEach((record) => {
        // Build a descriptive tag from the record's features
        const tag = buildTagFromRecord(record);
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });

      console.log(`initializeFeatureCodes: Found ${Object.keys(tagCounts).length} unique tags`);

      // Convert to FeatureCode array with suggested codes
      const featureCodes: FeatureCode[] = Object.entries(tagCounts)
        .map(([tag, count]) => ({
          originalTag: tag,
          code: suggestFeatureCode(tag),
          count,
        }))
        .sort((a, b) => b.count - a.count);

      setState((prev) => ({
        ...prev,
        isLoading: false,
        featureCodes,
        rateRecords: allRecords,
      }));
    } catch (error) {
      console.error('Failed to initialize feature codes:', error);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        featureCodes: [],
      }));
      toast.error('Failed to load feature codes');
    }
  }, [state.selectedStores, state.rateRecords]);

  // Get the actual features from a record as a readable string
  const getRecordFeatures = (record: RateRecord): string => {
    const accessTypes: string[] = [];
    if (record.driveUp) accessTypes.push('Drive-Up');
    if (record.elevator) accessTypes.push('Elevator');
    if (record.outdoorAccess) accessTypes.push('Outdoor');

    const climateTypes: string[] = [];
    if (record.climateControlled) climateTypes.push('Climate');
    if (record.humidityControlled) climateTypes.push('Humidity');

    const access = accessTypes.length > 0 ? accessTypes.join('+') : 'Ground';
    const climate = climateTypes.length > 0 ? climateTypes.join('+') : 'Non-Climate';

    return `${access} / ${climate}`;
  };

  // Check if a record has conflicting amenities and return details
  const getConflictInfo = (record: RateRecord): { hasConflict: boolean; details: string } => {
    // Check for multiple access types (conflicting)
    const accessTypes: string[] = [];
    if (record.driveUp) accessTypes.push('Drive-Up');
    if (record.elevator) accessTypes.push('Elevator');
    if (record.outdoorAccess) accessTypes.push('Outdoor');

    if (accessTypes.length > 1) {
      return {
        hasConflict: true,
        details: getRecordFeatures(record),
      };
    }

    return { hasConflict: false, details: '' };
  };

  // Build a tag classification string from record features (matches RCA_script.py logic)
  const buildTagFromRecord = (record: RateRecord): string => {
    // Check for conflicting amenities first - but show actual features
    const conflictInfo = getConflictInfo(record);
    if (conflictInfo.hasConflict) {
      // Show actual features so user can make an informed decision
      return conflictInfo.details;
    }

    const parts: string[] = [];

    // Add access type
    if (record.driveUp) {
      parts.push('Drive-Up');
    } else if (record.elevator) {
      parts.push('Elevator');
    } else if (record.outdoorAccess) {
      parts.push('Outdoor');
    } else {
      parts.push('Ground Level');
    }

    // Add climate info
    if (record.climateControlled) {
      parts.push('Climate Controlled');
    } else if (record.humidityControlled) {
      parts.push('Humidity Controlled');
    } else {
      parts.push('Non-Climate');
    }

    // Fallback to existing tag or unitType if no features
    if (parts.length === 0) {
      return record.tag || record.unitType || 'Standard';
    }

    return parts.join(' / ');
  };

  // Suggest feature code based on tag text (matches RCA_script.py suggest_feature_code)
  const suggestFeatureCode = (featureText: string): string => {
    if (!featureText) return 'UNKNOWN';

    // Auto-code tags with multiple access types (e.g., "Drive-Up+Elevator") as NA for user review
    if (featureText.includes('+')) {
      return 'NA';
    }

    const lower = featureText.toLowerCase();

    // Check for climate control
    const isClimate = lower.includes('climate') && !lower.includes('non-climate');

    // Check for access type
    const isDriveUp = lower.includes('drive');
    const isElevator = lower.includes('elevator');
    const isGround = lower.includes('ground') || lower.includes('first floor');
    const isInterior = lower.includes('interior');
    const isOutdoor = lower.includes('outdoor');

    // Determine code based on access type + climate
    if (isDriveUp) {
      return isClimate ? 'DUCC' : 'DU';
    } else if (isElevator) {
      return isClimate ? 'ECC' : 'ENCC';
    } else if (isGround) {
      return isClimate ? 'GLCC' : 'GNCC';
    } else if (isInterior) {
      return isClimate ? 'ICC' : 'INCC';
    } else if (isOutdoor) {
      return isClimate ? 'OCC' : 'ONC';
    } else {
      // Default based on climate only
      return isClimate ? 'CC' : 'NCC';
    }
  };

  // Legacy function for backwards compatibility
  const generateFeatureCode = (tag: string): string => {
    return suggestFeatureCode(tag);
  };

  // Export real CSV data
  const exportCSV = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      // Fetch historical data for all selected stores
      const today = new Date();
      const fromDate = new Date(today);
      fromDate.setMonth(fromDate.getMonth() - 12);

      const allRecords: RateRecord[] = [];

      for (const store of state.selectedStores) {
        try {
          const records = await fetchHistoricalData({
            storeId: store.storeId,
            fromDate: fromDate.toISOString().split('T')[0],
            toDate: today.toISOString().split('T')[0],
          });
          allRecords.push(...records);
        } catch (e) {
          console.warn(`Failed to fetch data for store ${store.storeId}:`, e);
        }
      }

      if (allRecords.length === 0) {
        toast.error('No data available to export');
        setState((prev) => ({ ...prev, isLoading: false }));
        return;
      }

      // Auto-save API-fetched records to S3 for database import
      // This runs in the background and doesn't block the export
      if (allRecords.length > 0) {
        saveRatesToS3({
          rates: allRecords,
          metadata: {
            subjectStoreId: state.subjectStore?.storeId,
            analysisId: `rca-${Date.now()}`,
          }
        }).then((result) => {
          if (result.uploaded) {
            console.log(`Auto-saved ${result.recordCount} records to S3: ${result.s3Path}`);
          } else {
            console.warn('Failed to auto-save to S3:', result.message);
          }
        }).catch((err) => {
          console.warn('S3 auto-save error:', err);
        });
      }

      // Apply custom names
      const recordsWithNames = allRecords.map((record) => ({
        ...record,
        storeName: state.customNames[record.storeId] || record.storeName,
      }));

      // Generate CSV
      const headers = [
        'Store Name',
        'Address',
        'City',
        'State',
        'ZIP',
        'Unit Type',
        'Size',
        'Features',
        'Climate Controlled',
        'Drive Up',
        'Walk-In Price',
        'Online Price',
        'Date',
        'Promo',
      ];

      const rows = recordsWithNames.map((r) => [
        `"${r.storeName}"`,
        `"${r.address}"`,
        `"${r.city}"`,
        `"${r.state}"`,
        `"${r.zip}"`,
        `"${r.unitType}"`,
        `"${r.size}"`,
        `"${r.features || ''}"`,
        r.climateControlled ? 'Yes' : 'No',
        r.driveUp ? 'Yes' : 'No',
        r.walkInPrice || '',
        r.onlinePrice || '',
        r.date,
        `"${r.promo || ''}"`,
      ]);

      const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `RCA_export_${new Date().toISOString().slice(0, 10)}_data.csv`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success(`Exported ${recordsWithNames.length} records`);
      setState((prev) => ({ ...prev, isLoading: false }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to export data';
      console.error('Export error:', error);
      toast.error(message);
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [state.selectedStores, state.customNames, state.subjectStore]);

  // Download data dump CSV for editing
  const downloadDataDump = useCallback(() => {
    if (state.rateRecords.length === 0) {
      toast.error('No data to download');
      return;
    }

    const headers = [
      'Store ID',
      'Store Name',
      'Address',
      'City',
      'State',
      'ZIP',
      'Unit Type',
      'Size',
      'Features',
      'Climate Controlled',
      'Drive Up',
      'Elevator',
      'Walk-In Price',
      'Online Price',
      'Date',
      'Promo',
    ];

    const rows = state.rateRecords.map((r) => [
      r.storeId,
      `"${state.customNames[r.storeId] || r.storeName}"`,
      `"${r.address}"`,
      `"${r.city}"`,
      `"${r.state}"`,
      `"${r.zip}"`,
      `"${r.unitType}"`,
      `"${r.size}"`,
      `"${r.features || ''}"`,
      r.climateControlled ? 'Yes' : 'No',
      r.driveUp ? 'Yes' : 'No',
      r.elevator ? 'Yes' : 'No',
      r.walkInPrice || '',
      r.onlinePrice || '',
      r.date,
      `"${r.promo || ''}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `RCA_data_dump_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success(`Downloaded ${state.rateRecords.length} records for editing`);
  }, [state.rateRecords, state.customNames]);

  // Upload edited CSV and replace rate records
  const uploadEditedCSV = useCallback((records: RateRecord[]) => {
    setState((prev) => ({
      ...prev,
      rateRecords: records,
    }));
    toast.success('Rate records updated from uploaded CSV');
  }, []);

  // Exclude specific records (for outlier removal)
  const excludeRecords = useCallback((recordIds: string[]) => {
    const idSet = new Set(recordIds);
    setState((prev) => ({
      ...prev,
      rateRecords: prev.rateRecords.filter((r) => {
        const id = `${r.storeId}-${r.size}-${r.date}-${r.walkInPrice}-${r.onlinePrice}`;
        return !idSet.has(id);
      }),
    }));
  }, []);

  // Apply store-specific rate adjustments (e.g., US Storage Center 2x rates)
  const applyStoreRateMultiplier = useCallback((storeNamePattern: string, multiplier: number) => {
    const pattern = storeNamePattern.toLowerCase();
    setState((prev) => {
      const updatedRecords = prev.rateRecords.map((record) => {
        const storeName = (prev.customNames[record.storeId] || record.storeName).toLowerCase();
        if (storeName.includes(pattern)) {
          return {
            ...record,
            walkInPrice: record.walkInPrice ? record.walkInPrice * multiplier : undefined,
            onlinePrice: record.onlinePrice ? record.onlinePrice * multiplier : undefined,
          };
        }
        return record;
      });

      return { ...prev, rateRecords: updatedRecords };
    });

    toast.success(`Applied ${multiplier}x rate multiplier to stores matching "${storeNamePattern}"`);
  }, []);

  // Reset wizard and clear persisted state
  const resetWizard = useCallback(() => {
    clearPersistedState();
    setState({
      currentStep: 1,
      searchCriteria: initialSearchCriteria,
      searchResults: [],
      subjectStore: null,
      competitors: [],
      selectedStores: [],
      storeMetadata: {},
      storeRankings: {},
      adjustmentFactors: initialAdjustmentFactors,
      customNames: {},
      dateGaps: [],
      apiStoreIds: [],
      featureCodes: [],
      rateRecords: [],
      isLoading: false,
      error: null,
    });
  }, []);

  return {
    state,
    actions: {
      setStep,
      nextStep,
      prevStep,
      updateSearchCriteria,
      searchStores,
      selectSubjectStore,
      selectStoresForAnalysis,
      fetchStoreMetadata,
      fetchSalesforceMatchesForStore,
      updateStoreMetadata,
      updateStoreRankings,
      updateAdjustmentFactors,
      updateCustomName,
      analyzeGaps,
      setApiStoreIds,
      fillDataGaps,
      updateFeatureCode,
      initializeFeatureCodes,
      exportCSV,
      downloadDataDump,
      uploadEditedCSV,
      excludeRecords,
      applyStoreRateMultiplier,
      resetWizard,
    },
  };
}
