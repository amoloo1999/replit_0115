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
      // Use String() to ensure key lookup works regardless of type (JSON keys are strings)
      const gaps: DateGap[] = state.selectedStores.map((store) => {
        const dates = result.datesByStore[store.storeId] || result.datesByStore[String(store.storeId)] || [];
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

    // Remove duplicates (same store, size, date, AND feature flags)
    // Key must include features to distinguish different unit types with same size
    const buildRecordKey = (r: RateRecord) =>
      `${r.storeId}-${r.size}-${r.date}-${r.climateControlled ? 'CC' : 'NCC'}-${r.driveUp ? 'DU' : ''}-${r.elevator ? 'E' : ''}-${r.outdoorAccess ? 'O' : ''}`;

    const uniqueRecords: RateRecord[] = [];
    const seenKeys = new Set<string>();

    for (const record of mergedRecords) {
      const key = buildRecordKey(record);
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

      // Collect database records - iterate over all keys in ratesByStore to avoid type mismatches
      // (keys may be strings after JSON parsing even though storeIds are numbers)
      const dbRecords: RateRecord[] = [];
      const ratesByStoreKeys = Object.keys(result.ratesByStore || {});
      console.log(`initializeFeatureCodes: ratesByStore has ${ratesByStoreKeys.length} store keys:`, ratesByStoreKeys);

      for (const key of ratesByStoreKeys) {
        const storeRecords = result.ratesByStore[key] || [];
        console.log(`initializeFeatureCodes: Store ${key} has ${storeRecords.length} records`);
        dbRecords.push(...storeRecords);
      }
      console.log(`initializeFeatureCodes: Fetched ${dbRecords.length} total records from database`);

      // Merge: API records take precedence, add DB records that don't exist in API set
      // Build a set of keys from existing records for deduplication
      // Key includes: storeId, size, date, AND feature flags to distinguish different unit types
      const buildRecordKey = (r: RateRecord) =>
        `${r.storeId}-${r.size}-${r.date}-${r.climateControlled ? 'CC' : 'NCC'}-${r.driveUp ? 'DU' : ''}-${r.elevator ? 'E' : ''}-${r.outdoorAccess ? 'O' : ''}`;

      const existingKeys = new Set(allRecords.map(buildRecordKey));

      // Add DB records that aren't already in our set
      for (const record of dbRecords) {
        const key = buildRecordKey(record);
        if (!existingKeys.has(key)) {
          allRecords.push(record);
          existingKeys.add(key);
        }
      }

      console.log(`initializeFeatureCodes: Total merged records before filtering: ${allRecords.length}`);

      // Filter out lockers, parking, and other non-standard unit types
      const excludedUnitTypes = ['locker', 'parking', 'wine', 'vehicle', 'rv', 'boat', 'trailer', 'car'];
      const filteredRecords = allRecords.filter((record) => {
        const unitTypeLower = (record.unitType || '').toLowerCase();
        const sizeLower = (record.size || '').toLowerCase();
        const featuresLower = (record.features || '').toLowerCase();

        // Check if any excluded term appears in unitType, size, or features
        const isExcluded = excludedUnitTypes.some(
          (term) =>
            unitTypeLower.includes(term) ||
            sizeLower.includes(term) ||
            featuresLower.includes(term)
        );

        return !isExcluded;
      });

      console.log(`initializeFeatureCodes: Filtered to ${filteredRecords.length} records (excluded ${allRecords.length - filteredRecords.length} lockers/parking/etc.)`);

      // Update allRecords to use filtered set
      allRecords = filteredRecords;

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

  /**
   * Build a detailed feature description string from a rate record.
   * This provides users with all available feature information to help them
   * make informed decisions when classifying units that can't be auto-coded.
   */
  const buildFeatureDescription = (record: RateRecord): string => {
    const parts: string[] = [];

    // Access type indicators
    if (record.driveUp) parts.push('Drive-Up');
    if (record.elevator) parts.push('Elevator');
    if (record.outdoorAccess) parts.push('Exterior/Outdoor');

    // If none of the above, check for ground level indicators
    if (!record.driveUp && !record.elevator && !record.outdoorAccess) {
      parts.push('Ground Level');
    }

    // Climate indicators
    if (record.climateControlled) {
      parts.push('Climate Controlled');
    } else if (record.humidityControlled) {
      parts.push('Humidity Controlled');
    } else {
      parts.push('Non-Climate');
    }

    // Include unit type/spacetype if available for additional context
    if (record.unitType && record.unitType !== 'Standard') {
      parts.push(`[${record.unitType}]`);
    }

    // Include raw features string if available and different from what we parsed
    if (record.features && !parts.some(p => record.features?.toLowerCase().includes(p.toLowerCase().split(' ')[0]))) {
      parts.push(`(${record.features})`);
    }

    return parts.join(' / ');
  };

  /**
   * Determine the feature code for a record based on strict classification rules.
   *
   * Valid codes (only 6):
   * - DUCC: Drive-Up Climate Controlled (drive-up + exterior + climate)
   * - DU: Drive-Up Non-Climate (drive-up + exterior + non-climate)
   * - ECC: Elevator Climate Controlled (elevator + interior + climate)
   * - ENCC: Elevator Non-Climate Controlled (elevator + interior + non-climate or unknown)
   * - GLCC: Ground Level Climate Controlled (ground/first floor + interior + climate)
   * - GNCC: Ground Level Non-Climate Controlled (ground/first floor + interior + non-climate or unknown)
   *
   * Returns N/A for:
   * - Conflicting features (drive-up + interior, elevator + exterior, etc.)
   * - Insufficient information to determine classification
   * - Ambiguous combinations
   */
  const classifyFeatureCode = (record: RateRecord): { code: string; isConflict: boolean; reason?: string } => {
    const isDriveUp = !!record.driveUp;
    const isElevator = !!record.elevator;
    const isOutdoor = !!record.outdoorAccess;
    const isClimate = !!record.climateControlled;

    // Check for conflicting access types
    const accessTypeCount = [isDriveUp, isElevator].filter(Boolean).length;

    if (accessTypeCount > 1) {
      // Multiple access types are conflicting
      return {
        code: 'N/A',
        isConflict: true,
        reason: 'Multiple access types (drive-up and elevator are mutually exclusive)'
      };
    }

    // Drive-Up rules: must be exterior, cannot be interior
    if (isDriveUp) {
      // Drive-up should always be exterior - if marked as interior or elevator, it's conflicting
      if (isElevator) {
        return {
          code: 'N/A',
          isConflict: true,
          reason: 'Drive-up cannot have elevator access'
        };
      }
      // Drive-up is valid - determine climate status
      return {
        code: isClimate ? 'DUCC' : 'DU',
        isConflict: false
      };
    }

    // Elevator rules: must be interior
    if (isElevator) {
      // Elevator with outdoor/exterior is conflicting
      if (isOutdoor) {
        return {
          code: 'N/A',
          isConflict: true,
          reason: 'Elevator access should be interior, not exterior/outdoor'
        };
      }
      // Elevator is valid - determine climate status (non-climate or unknown = ENCC)
      return {
        code: isClimate ? 'ECC' : 'ENCC',
        isConflict: false
      };
    }

    // Ground level rules: must be interior, first floor
    // If no drive-up and no elevator, assume ground level
    if (!isDriveUp && !isElevator) {
      // Ground level with outdoor access is conflicting (should be drive-up instead)
      if (isOutdoor) {
        return {
          code: 'N/A',
          isConflict: true,
          reason: 'Exterior/outdoor access without drive-up designation - unclear classification'
        };
      }
      // Ground level interior - determine climate status (non-climate or unknown = GNCC)
      return {
        code: isClimate ? 'GLCC' : 'GNCC',
        isConflict: false
      };
    }

    // Fallback - no clear classification possible
    return {
      code: 'N/A',
      isConflict: true,
      reason: 'Insufficient feature information for classification'
    };
  };

  /**
   * Build a tag classification string from record features.
   * This tag is used to group similar records and display to the user.
   * Returns detailed feature info so users can make informed decisions.
   */
  const buildTagFromRecord = (record: RateRecord): string => {
    return buildFeatureDescription(record);
  };

  /**
   * Suggest a feature code based on the tag text.
   * Only returns one of 6 valid codes (DUCC, DU, ECC, ENCC, GLCC, GNCC) or N/A.
   */
  const suggestFeatureCode = (featureText: string): string => {
    if (!featureText) return 'N/A';

    const lower = featureText.toLowerCase();

    // Detect feature flags from text
    const isDriveUp = lower.includes('drive');
    const isElevator = lower.includes('elevator');
    const isOutdoor = lower.includes('outdoor') || lower.includes('exterior');
    const isClimate = (lower.includes('climate') && !lower.includes('non-climate')) ||
                      (lower.includes('cc') && !lower.includes('ncc') && !lower.includes('encc'));
    const isGround = lower.includes('ground') || lower.includes('first floor') || lower.includes('1st floor');

    // Check for conflicts

    // Multiple access types = conflict
    const accessTypes = [isDriveUp, isElevator].filter(Boolean);
    if (accessTypes.length > 1) {
      return 'N/A';
    }

    // Drive-up classification
    if (isDriveUp) {
      // Drive-up should be exterior - interior is a conflict
      // But we allow it since drive-up inherently implies exterior
      return isClimate ? 'DUCC' : 'DU';
    }

    // Elevator classification
    if (isElevator) {
      // Elevator with outdoor/exterior is a conflict
      if (isOutdoor) {
        return 'N/A';
      }
      return isClimate ? 'ECC' : 'ENCC';
    }

    // Ground level classification
    if (isGround || (!isDriveUp && !isElevator && !isOutdoor)) {
      // Ground with outdoor that's not drive-up is ambiguous
      if (isOutdoor && !isDriveUp) {
        return 'N/A';
      }
      return isClimate ? 'GLCC' : 'GNCC';
    }

    // Outdoor without clear access type
    if (isOutdoor) {
      return 'N/A';
    }

    // No identifiable features = N/A
    return 'N/A';
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
