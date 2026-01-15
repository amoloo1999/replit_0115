import { useState, useMemo, useEffect, useRef } from 'react';
import { FileDown, FileUp, BarChart3, Loader2, ChevronDown, ChevronRight, Settings2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { Store, StoreMetadata, AdjustmentFactors, RateRecord, FeatureCode, StoreRankings } from '@/types/rca';
import { toast } from 'sonner';

// Default unit sizes from RCA_script.py
const DEFAULT_UNIT_SIZES = ['5x5', '5x10', '10x10', '10x15', '10x20', '10x25', '10x30'];
const ALL_UNIT_SIZES = ['5x5', '5x10', '10x5', '10x10', '10x15', '10x20', '10x25', '10x30', '10x40', '15x15', '15x20', '20x20'];

// Outlier detection result
interface OutlierRecord {
  record: RateRecord;
  reason: string;
  deviation: number; // How far from the mean (in std devs)
  groupKey: string;
  confirmed: boolean | null; // null = pending, true = keep, false = exclude
}

// Predefined store-specific tasks
interface StoreTask {
  id: string;
  name: string;
  description: string;
  storePattern: string;
  multiplier: number;
}

const STORE_TASKS: StoreTask[] = [
  {
    id: 'us-storage-2x',
    name: 'US Storage Center 2x Rates',
    description: 'Double the rates for US Storage Center stores (known pricing display issue)',
    storePattern: 'us storage',
    multiplier: 2,
  },
];

interface StepDataVisualizationProps {
  subjectStore: Store | null;
  selectedStores: Store[];
  storeMetadata: Record<number, StoreMetadata>;
  storeRankings: Record<number, StoreRankings>;
  adjustmentFactors: AdjustmentFactors;
  rateRecords: RateRecord[];
  customNames: Record<number, string>;
  featureCodes: FeatureCode[];
  onExport: () => void;
  onDownloadDataDump: () => void;
  onUploadEditedCSV: (records: RateRecord[]) => void;
  onExcludeRecords: (recordIds: string[]) => void;
  onApplyStoreMultiplier: (pattern: string, multiplier: number) => void;
  isLoading: boolean;
  onBack: () => void;
}

interface GroupedData {
  size: string;
  featureCode: string;
  stores: {
    storeId: number;
    storeName: string;
    distance: number;
    yearBuilt: number | null;
    squareFootage: number | null;
    isSubject: boolean;
    t12Asking: number | null;
    t12AskingAdj: number | null;
    t12InStore: number | null;
    t6Asking: number | null;
    t6AskingAdj: number | null;
    t6InStore: number | null;
    t3Asking: number | null;
    t3AskingAdj: number | null;
    t3InStore: number | null;
    t1Asking: number | null;
    t1AskingAdj: number | null;
    t1InStore: number | null;
    adjustment: number;
    recordCount: number;
  }[];
  averages: {
    t12Asking: number | null;
    t12AskingAdj: number | null;
    t12InStore: number | null;
    t6Asking: number | null;
    t6AskingAdj: number | null;
    t6InStore: number | null;
    t3Asking: number | null;
    t3AskingAdj: number | null;
    t3InStore: number | null;
    t1Asking: number | null;
    t1AskingAdj: number | null;
    t1InStore: number | null;
  };
  marketShare: number;
}

export function StepDataVisualization({
  subjectStore,
  selectedStores,
  storeMetadata,
  storeRankings,
  adjustmentFactors,
  rateRecords,
  customNames,
  featureCodes,
  onExport,
  onDownloadDataDump,
  onUploadEditedCSV,
  onExcludeRecords,
  onApplyStoreMultiplier,
  isLoading,
  onBack
}: StepDataVisualizationProps) {
  const [selectedSizes, setSelectedSizes] = useState<string[]>(DEFAULT_UNIT_SIZES);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showSizeSelector, setShowSizeSelector] = useState(false);
  const [showOutlierDialog, setShowOutlierDialog] = useState(false);
  const [outliers, setOutliers] = useState<OutlierRecord[]>([]);
  const [excludedRecordIds, setExcludedRecordIds] = useState<Set<string>>(new Set());
  const [appliedTasks, setAppliedTasks] = useState<Set<string>>(new Set());
  const [pendingTask, setPendingTask] = useState<StoreTask | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check which store tasks are applicable (matching stores exist in data)
  const applicableTasks = useMemo(() => {
    return STORE_TASKS.filter(task => {
      const pattern = task.storePattern.toLowerCase();
      return selectedStores.some(store => {
        const name = (customNames[store.storeId] || store.storeName).toLowerCase();
        return name.includes(pattern);
      });
    });
  }, [selectedStores, customNames]);

  // Handle applying a store task with confirmation
  const handleApplyTask = (task: StoreTask) => {
    setPendingTask(task);
  };

  const confirmApplyTask = () => {
    if (pendingTask) {
      onApplyStoreMultiplier(pendingTask.storePattern, pendingTask.multiplier);
      setAppliedTasks(prev => new Set([...prev, pendingTask.id]));
      setPendingTask(null);
    }
  };

  // Generate a unique ID for a record
  const getRecordId = (record: RateRecord) =>
    `${record.storeId}-${record.size}-${record.date}-${record.walkInPrice}-${record.onlinePrice}`;

  // Detect outliers using IQR method
  const detectOutliers = useMemo(() => {
    if (rateRecords.length === 0) return [];

    const outlierList: OutlierRecord[] = [];
    const OUTLIER_THRESHOLD = 2.5; // Standard deviations from mean

    // Group records by size and feature code
    const groups: Record<string, RateRecord[]> = {};
    rateRecords.forEach(record => {
      const key = `${record.size}|${record.climateControlled ? 'CC' : 'NCC'}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(record);
    });

    // For each group, find outliers
    Object.entries(groups).forEach(([groupKey, records]) => {
      if (records.length < 5) return; // Need enough data for statistical analysis

      // Get all prices (prefer online, fallback to walkIn)
      const prices = records
        .map(r => r.onlinePrice || r.walkInPrice)
        .filter((p): p is number => p != null && p > 0);

      if (prices.length < 5) return;

      // Calculate mean and standard deviation
      const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
      const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
      const stdDev = Math.sqrt(variance);

      if (stdDev === 0) return;

      // Find records that are outliers
      records.forEach(record => {
        const price = record.onlinePrice || record.walkInPrice;
        if (!price) return;

        const deviation = Math.abs(price - mean) / stdDev;
        if (deviation > OUTLIER_THRESHOLD) {
          const direction = price > mean ? 'high' : 'low';
          outlierList.push({
            record,
            reason: `Price $${price.toFixed(0)} is ${deviation.toFixed(1)} std devs ${direction} (mean: $${mean.toFixed(0)})`,
            deviation,
            groupKey,
            confirmed: null,
          });
        }
      });
    });

    // Sort by deviation (most extreme first)
    outlierList.sort((a, b) => b.deviation - a.deviation);

    return outlierList;
  }, [rateRecords]);

  // Update outliers state when detection runs
  useEffect(() => {
    if (detectOutliers.length > 0 && outliers.length === 0) {
      setOutliers(detectOutliers);
    }
  }, [detectOutliers]);

  // Handle confirming/denying an outlier
  const handleOutlierDecision = (index: number, keep: boolean) => {
    setOutliers(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], confirmed: keep };
      return updated;
    });

    if (!keep) {
      const outlier = outliers[index];
      const recordId = getRecordId(outlier.record);
      setExcludedRecordIds(prev => new Set([...prev, recordId]));
    }
  };

  // Apply exclusions
  const applyOutlierExclusions = () => {
    const toExclude = outliers
      .filter(o => o.confirmed === false)
      .map(o => getRecordId(o.record));

    if (toExclude.length > 0) {
      onExcludeRecords(toExclude);
      toast.success(`Excluded ${toExclude.length} outlier records`);
    }
    setShowOutlierDialog(false);
  };

  // Handle CSV file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split('\n');
        if (lines.length < 2) {
          toast.error('CSV file is empty or invalid');
          return;
        }

        // Parse header
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));

        // Parse data rows
        const records: RateRecord[] = [];
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          // Simple CSV parsing (handles quoted values)
          const values: string[] = [];
          let current = '';
          let inQuotes = false;
          for (const char of line) {
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
              values.push(current.trim());
              current = '';
            } else {
              current += char;
            }
          }
          values.push(current.trim());

          // Map values to record based on headers
          const record: Partial<RateRecord> = {};
          headers.forEach((header, idx) => {
            const value = values[idx] || '';
            const lowerHeader = header.toLowerCase();

            if (lowerHeader.includes('store') && lowerHeader.includes('id')) {
              record.storeId = parseInt(value) || 0;
            } else if (lowerHeader.includes('store') && lowerHeader.includes('name')) {
              record.storeName = value;
            } else if (lowerHeader === 'address') {
              record.address = value;
            } else if (lowerHeader === 'city') {
              record.city = value;
            } else if (lowerHeader === 'state') {
              record.state = value;
            } else if (lowerHeader === 'zip') {
              record.zip = value;
            } else if (lowerHeader.includes('unit') && lowerHeader.includes('type')) {
              record.unitType = value;
            } else if (lowerHeader === 'size') {
              record.size = value;
            } else if (lowerHeader.includes('feature')) {
              record.features = value;
            } else if (lowerHeader.includes('climate')) {
              record.climateControlled = value.toLowerCase() === 'yes' || value === '1' || value.toLowerCase() === 'true';
            } else if (lowerHeader.includes('drive')) {
              record.driveUp = value.toLowerCase() === 'yes' || value === '1' || value.toLowerCase() === 'true';
            } else if (lowerHeader.includes('walk') && lowerHeader.includes('price')) {
              record.walkInPrice = parseFloat(value) || undefined;
            } else if (lowerHeader.includes('online') && lowerHeader.includes('price')) {
              record.onlinePrice = parseFloat(value) || undefined;
            } else if (lowerHeader === 'date') {
              record.date = value;
            } else if (lowerHeader === 'promo') {
              record.promo = value;
            }
          });

          if (record.storeId) {
            records.push({
              storeId: record.storeId,
              storeName: record.storeName || '',
              address: record.address || '',
              city: record.city || '',
              state: record.state || '',
              zip: record.zip || '',
              unitType: record.unitType || '',
              size: record.size || '',
              features: record.features || '',
              tag: record.unitType || '',
              climateControlled: record.climateControlled || false,
              humidityControlled: false,
              driveUp: record.driveUp || false,
              elevator: false,
              outdoorAccess: false,
              walkInPrice: record.walkInPrice,
              onlinePrice: record.onlinePrice,
              date: record.date || '',
              promo: record.promo || '',
              source: 'Database',
            });
          }
        }

        if (records.length > 0) {
          onUploadEditedCSV(records);
          toast.success(`Uploaded ${records.length} records from CSV`);
        } else {
          toast.error('No valid records found in CSV');
        }
      } catch (err) {
        console.error('CSV parse error:', err);
        toast.error('Failed to parse CSV file');
      }
    };
    reader.readAsText(file);

    // Reset input so same file can be uploaded again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Calculate total adjustment
  const totalAdjustment = 
    (adjustmentFactors.captiveMarketPremium || 0) + 
    (adjustmentFactors.lossToLease || 0) + 
    (adjustmentFactors.ccAdj || 0);

  // Get feature code for a record
  const getFeatureCode = (record: RateRecord): string => {
    // Build tag from record features
    const parts: string[] = [];

    if (record.driveUp) {
      parts.push('Drive-Up');
    } else if (record.elevator) {
      parts.push('Elevator');
    } else if (record.outdoorAccess) {
      parts.push('Outdoor');
    } else {
      parts.push('Ground Level');
    }

    if (record.climateControlled) {
      parts.push('Climate Controlled');
    } else if (record.humidityControlled) {
      parts.push('Humidity Controlled');
    } else {
      parts.push('Non-Climate');
    }

    const tag = parts.join(' / ');

    // Find matching feature code
    const fc = featureCodes.find(f => f.originalTag === tag);
    if (fc) return fc.code;

    // Fallback: suggest code based on features
    const isClimate = record.climateControlled;
    if (record.driveUp) return isClimate ? 'DUCC' : 'DU';
    if (record.elevator) return isClimate ? 'ECC' : 'ENCC';
    return isClimate ? 'GLCC' : 'GNCC';
  };

  // Calculate store-specific adjustment based on rankings
  const getStoreAdjustment = (storeId: number): number => {
    if (!subjectStore || storeId === subjectStore.storeId) return 0;

    const subjectRankings = storeRankings[subjectStore.storeId];
    const compRankings = storeRankings[storeId];

    if (!subjectRankings || !compRankings) return totalAdjustment / 100;

    // Calculate adjustment based on ranking differences
    let adjustment = totalAdjustment / 100;

    // Each ranking point difference = ~1% adjustment
    const rankingCategories = ['Location', 'Age', 'Accessibility', 'VPD', 'Visibility & Signage', 'Brand', 'Quality', 'Size'] as const;
    let totalDiff = 0;

    rankingCategories.forEach(cat => {
      const subjectVal = subjectRankings[cat] || 5;
      const compVal = compRankings[cat] || 5;
      totalDiff += (subjectVal - compVal);
    });

    // Average difference across categories, scaled
    adjustment += (totalDiff / rankingCategories.length) * 0.01;

    return adjustment;
  };

  // Group and process rate data
  const groupedData = useMemo(() => {
    if (rateRecords.length === 0) return [];

    const now = new Date();
    const t12Start = new Date(now);
    t12Start.setMonth(t12Start.getMonth() - 12);
    const t6Start = new Date(now);
    t6Start.setMonth(t6Start.getMonth() - 6);
    const t3Start = new Date(now);
    t3Start.setMonth(t3Start.getMonth() - 3);
    const t1Start = new Date(now);
    t1Start.setMonth(t1Start.getMonth() - 1);

    // Normalize size for comparison
    const normalizeSize = (size: string) => {
      return size.toLowerCase().replace(/\s/g, '').replace(/'/g, '');
    };

    // Filter to selected sizes
    const allowedSizes = new Set(selectedSizes.map(s => normalizeSize(s)));

    // Group by (size, featureCode)
    const groups: Record<string, Record<number, RateRecord[]>> = {};

    rateRecords.forEach(record => {
      const size = record.size || '';
      const normalizedSize = normalizeSize(size);

      if (!allowedSizes.has(normalizedSize)) return;

      const featureCode = getFeatureCode(record);
      const groupKey = `${size}|${featureCode}`;

      if (!groups[groupKey]) {
        groups[groupKey] = {};
      }

      if (!groups[groupKey][record.storeId]) {
        groups[groupKey][record.storeId] = [];
      }

      groups[groupKey][record.storeId].push(record);
    });

    // Calculate averages for each group
    const calcAverages = (records: RateRecord[], startDate: Date) => {
      const filtered = records.filter(r => {
        const date = new Date(r.date);
        return date >= startDate;
      });

      const walkIn = filtered.filter(r => r.walkInPrice != null && r.walkInPrice > 0).map(r => r.walkInPrice!);
      const online = filtered.filter(r => r.onlinePrice != null && r.onlinePrice > 0).map(r => r.onlinePrice!);

      // Use online price for asking, fall back to walkIn if no online prices available
      const askingPrices = online.length > 0 ? online : walkIn;

      return {
        inStore: walkIn.length > 0 ? walkIn.reduce((a, b) => a + b, 0) / walkIn.length : null,
        asking: askingPrices.length > 0 ? askingPrices.reduce((a, b) => a + b, 0) / askingPrices.length : null,
      };
    };

    // Parse size for sorting
    const parseSize = (sizeStr: string): number => {
      const parts = sizeStr.toLowerCase().replace(/x/g, ' ').replace(/'/g, '').split(/\s+/);
      try {
        if (parts.length >= 2) {
          return parseFloat(parts[0]) * parseFloat(parts[1]);
        }
        return parseFloat(parts[0]) || 0;
      } catch {
        return 0;
      }
    };

    // Build grouped data
    const result: GroupedData[] = [];
    const totalRecords = rateRecords.length;

    Object.entries(groups).forEach(([groupKey, storeRecords]) => {
      const [size, featureCode] = groupKey.split('|');

      const storeData = Object.entries(storeRecords).map(([storeIdStr, records]) => {
        const storeId = parseInt(storeIdStr);
        const store = selectedStores.find(s => s.storeId === storeId);
        const metadata = storeMetadata[storeId];
        const adjustment = getStoreAdjustment(storeId);

        const t12 = calcAverages(records, t12Start);
        const t6 = calcAverages(records, t6Start);
        const t3 = calcAverages(records, t3Start);
        const t1 = calcAverages(records, t1Start);

        return {
          storeId,
          storeName: customNames[storeId] || store?.storeName || 'Unknown',
          distance: store?.distance || 0,
          yearBuilt: metadata?.yearBuilt || null,
          squareFootage: metadata?.squareFootage || null,
          isSubject: subjectStore?.storeId === storeId,
          t12Asking: t12.asking,
          t12AskingAdj: t12.asking ? t12.asking * (1 + adjustment) : null,
          t12InStore: t12.inStore,
          t6Asking: t6.asking,
          t6AskingAdj: t6.asking ? t6.asking * (1 + adjustment) : null,
          t6InStore: t6.inStore,
          t3Asking: t3.asking,
          t3AskingAdj: t3.asking ? t3.asking * (1 + adjustment) : null,
          t3InStore: t3.inStore,
          t1Asking: t1.asking,
          t1AskingAdj: t1.asking ? t1.asking * (1 + adjustment) : null,
          t1InStore: t1.inStore,
          adjustment,
          recordCount: records.length,
        };
      });

      // Sort stores: subject first, then by distance
      storeData.sort((a, b) => {
        if (a.isSubject) return -1;
        if (b.isSubject) return 1;
        return a.distance - b.distance;
      });

      // Calculate group averages
      const allGroupRecords = Object.values(storeRecords).flat();
      const t12Avg = calcAverages(allGroupRecords, t12Start);
      const t6Avg = calcAverages(allGroupRecords, t6Start);
      const t3Avg = calcAverages(allGroupRecords, t3Start);
      const t1Avg = calcAverages(allGroupRecords, t1Start);

      // Calculate adjusted averages from all stores (including subject for more complete data)
      const calcAdjustedAverage = (stores: typeof storeData, key: keyof typeof storeData[0], excludeSubject = false) => {
        const values = stores
          .filter(s => (!excludeSubject || !s.isSubject) && s[key] !== null && s[key] !== undefined)
          .map(s => s[key] as number);
        return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
      };

      // Market share (percentage of total records in this group)
      const groupRecordCount = allGroupRecords.length;
      const marketShare = (groupRecordCount / totalRecords) * 100;

      result.push({
        size,
        featureCode,
        stores: storeData,
        averages: {
          t12Asking: t12Avg.asking,
          t12AskingAdj: calcAdjustedAverage(storeData, 't12AskingAdj'),
          t12InStore: t12Avg.inStore,
          t6Asking: t6Avg.asking,
          t6AskingAdj: calcAdjustedAverage(storeData, 't6AskingAdj'),
          t6InStore: t6Avg.inStore,
          t3Asking: t3Avg.asking,
          t3AskingAdj: calcAdjustedAverage(storeData, 't3AskingAdj'),
          t3InStore: t3Avg.inStore,
          t1Asking: t1Avg.asking,
          t1AskingAdj: calcAdjustedAverage(storeData, 't1AskingAdj'),
          t1InStore: t1Avg.inStore,
        },
        marketShare,
      });
    });

    // Sort by size then feature code
    result.sort((a, b) => {
      const sizeCompare = parseSize(a.size) - parseSize(b.size);
      if (sizeCompare !== 0) return sizeCompare;
      return a.featureCode.localeCompare(b.featureCode);
    });

    return result;
  }, [rateRecords, selectedSizes, selectedStores, subjectStore, customNames, storeMetadata, featureCodes, storeRankings, totalAdjustment]);

  // Expand all groups by default when data loads
  useEffect(() => {
    if (groupedData.length > 0 && expandedGroups.size === 0) {
      setExpandedGroups(new Set(groupedData.map(g => `${g.size}|${g.featureCode}`)));
    }
  }, [groupedData]);

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };

  const toggleSize = (size: string) => {
    setSelectedSizes(prev => {
      if (prev.includes(size)) {
        return prev.filter(s => s !== size);
      }
      return [...prev, size];
    });
  };

  const formatCurrency = (value: number | null) => {
    if (value === null || value === undefined) return 'N/A';
    return `$${value.toFixed(0)}`;
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

  const formatDistance = (value: number) => {
    return `${value.toFixed(2)} mi`;
  };

  return (
    <div className="max-w-full mx-auto animate-fade-in">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-semibold mb-2">Rate Comparison Analysis</h2>
        <p className="text-muted-foreground">
          View rate averages by unit size and feature code
        </p>
      </div>

      {/* Summary Header */}
      <Card className="mb-6">
        <CardContent className="pt-4">
          <div className="grid md:grid-cols-5 gap-4">
            <div>
              <div className="text-sm text-muted-foreground">Subject Store</div>
              <div className="font-semibold truncate">{subjectStore?.storeName || 'Not selected'}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Competitors</div>
              <div className="font-semibold">{selectedStores.length - 1}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Total Records</div>
              <div className="font-semibold">{rateRecords.length.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Unit Types</div>
              <div className="font-semibold">{groupedData.length}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Base Adjustment</div>
              <div className="font-semibold font-mono">{totalAdjustment.toFixed(1)}%</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Unit Size Selector */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Unit Sizes:</span>
          <div className="flex flex-wrap gap-1">
            {selectedSizes.map(size => (
              <Badge key={size} variant="secondary" className="text-xs">
                {size}
              </Badge>
            ))}
          </div>
        </div>
        <Dialog open={showSizeSelector} onOpenChange={setShowSizeSelector}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Settings2 className="w-4 h-4 mr-2" />
              Configure Sizes
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Select Unit Sizes</DialogTitle>
              <DialogDescription>
                Choose which unit sizes to include in the analysis
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-3 gap-4 py-4">
              {ALL_UNIT_SIZES.map(size => (
                <div key={size} className="flex items-center space-x-2">
                  <Checkbox
                    id={`size-${size}`}
                    checked={selectedSizes.includes(size)}
                    onCheckedChange={() => toggleSize(size)}
                  />
                  <label htmlFor={`size-${size}`} className="text-sm font-medium cursor-pointer">
                    {size}
                  </label>
                </div>
              ))}
            </div>
            <div className="flex justify-between">
              <Button variant="outline" size="sm" onClick={() => setSelectedSizes(DEFAULT_UNIT_SIZES)}>
                Reset to Default
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSelectedSizes(ALL_UNIT_SIZES)}>
                Select All
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Main Data Grid */}
      {rateRecords.length === 0 ? (
        <Card className="mb-6">
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No rate data available yet.</p>
              <p className="text-sm mt-1">Data will be fetched when you export.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="h-[600px] border rounded-lg bg-white">
          <div className="min-w-[1200px]">
            {/* Table Header */}
            <div className="sticky top-0 bg-slate-100 z-10 border-b text-xs font-semibold">
              <div className="grid grid-cols-[280px,55px,50px,70px,70px,70px,70px,70px,70px,70px,70px,70px,70px,70px,70px]">
                <div className="p-2 border-r">Property Name</div>
                <div className="p-2 border-r text-center">Miles</div>
                <div className="p-2 border-r text-center">Year</div>
                <div className="p-2 border-r text-center bg-blue-100">T-12<br/>Adj</div>
                <div className="p-2 border-r text-center bg-green-100">T-12<br/>Unadj</div>
                <div className="p-2 border-r text-center bg-amber-100">T-12<br/>In-Store</div>
                <div className="p-2 border-r text-center bg-blue-100">T-6<br/>Adj</div>
                <div className="p-2 border-r text-center bg-green-100">T-6<br/>Unadj</div>
                <div className="p-2 border-r text-center bg-amber-100">T-6<br/>In-Store</div>
                <div className="p-2 border-r text-center bg-blue-100">T-3<br/>Adj</div>
                <div className="p-2 border-r text-center bg-green-100">T-3<br/>Unadj</div>
                <div className="p-2 border-r text-center bg-amber-100">T-3<br/>In-Store</div>
                <div className="p-2 border-r text-center bg-blue-100">T-1<br/>Adj</div>
                <div className="p-2 border-r text-center bg-green-100">T-1<br/>Unadj</div>
                <div className="p-2 text-center bg-amber-100">T-1<br/>In-Store</div>
              </div>
            </div>

            {/* Data Rows */}
            {groupedData.map((group) => {
              const groupKey = `${group.size}|${group.featureCode}`;
              const isExpanded = expandedGroups.has(groupKey);
              const subjectStoreData = group.stores.find(s => s.isSubject);

              return (
                <Collapsible key={groupKey} open={isExpanded} onOpenChange={() => toggleGroup(groupKey)}>
                  {/* Group Header */}
                  <CollapsibleTrigger asChild>
                    <div className="grid grid-cols-[280px,55px,50px,70px,70px,70px,70px,70px,70px,70px,70px,70px,70px,70px,70px] bg-slate-200 hover:bg-slate-300 cursor-pointer border-b text-xs font-semibold">
                      <div className="p-2 border-r flex items-center gap-2">
                        {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        <span className="text-muted-foreground">{formatPercent(group.marketShare)}</span>
                        <Badge variant="outline" className="font-mono text-[10px]">{group.size}</Badge>
                        <Badge className="text-[10px]">{group.featureCode}</Badge>
                      </div>
                      <div className="p-2 border-r"></div>
                      <div className="p-2 border-r"></div>
                      <div className="p-2 border-r text-center font-mono bg-blue-200">
                        {subjectStoreData ? formatCurrency(subjectStoreData.t12AskingAdj) : 'N/A'}
                      </div>
                      <div className="p-2 border-r text-center font-mono bg-green-200">
                        {formatCurrency(group.averages.t12Asking)}
                      </div>
                      <div className="p-2 border-r text-center font-mono bg-amber-200">
                        {formatCurrency(group.averages.t12InStore)}
                      </div>
                      <div className="p-2 border-r text-center font-mono bg-blue-200">
                        {subjectStoreData ? formatCurrency(subjectStoreData.t6AskingAdj) : 'N/A'}
                      </div>
                      <div className="p-2 border-r text-center font-mono bg-green-200">
                        {formatCurrency(group.averages.t6Asking)}
                      </div>
                      <div className="p-2 border-r text-center font-mono bg-amber-200">
                        {formatCurrency(group.averages.t6InStore)}
                      </div>
                      <div className="p-2 border-r text-center font-mono bg-blue-200">
                        {subjectStoreData ? formatCurrency(subjectStoreData.t3AskingAdj) : 'N/A'}
                      </div>
                      <div className="p-2 border-r text-center font-mono bg-green-200">
                        {formatCurrency(group.averages.t3Asking)}
                      </div>
                      <div className="p-2 border-r text-center font-mono bg-amber-200">
                        {formatCurrency(group.averages.t3InStore)}
                      </div>
                      <div className="p-2 border-r text-center font-mono bg-blue-200">
                        {subjectStoreData ? formatCurrency(subjectStoreData.t1AskingAdj) : 'N/A'}
                      </div>
                      <div className="p-2 border-r text-center font-mono bg-green-200">
                        {formatCurrency(group.averages.t1Asking)}
                      </div>
                      <div className="p-2 text-center font-mono bg-amber-200">
                        {formatCurrency(group.averages.t1InStore)}
                      </div>
                    </div>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    {/* Store Rows */}
                    {group.stores.map((store, idx) => (
                      <div 
                        key={store.storeId}
                        className={`grid grid-cols-[280px,55px,50px,70px,70px,70px,70px,70px,70px,70px,70px,70px,70px,70px,70px] border-b text-xs ${
                          store.isSubject ? 'bg-green-100 font-medium' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                        }`}
                      >
                        <div className="p-2 border-r truncate flex items-center gap-1">
                          <span className="text-muted-foreground w-4 text-right">{idx + 1}</span>
                          <span className="truncate">{store.storeName}</span>
                          {store.isSubject && <Badge variant="default" className="ml-1 text-[9px] py-0 px-1">Subject</Badge>}
                        </div>
                        <div className="p-2 border-r text-center font-mono text-muted-foreground">
                          {store.distance > 0 ? formatDistance(store.distance) : '-'}
                        </div>
                        <div className="p-2 border-r text-center text-muted-foreground">
                          {store.yearBuilt || '-'}
                        </div>
                        <div className="p-2 border-r text-center font-mono bg-blue-50">
                          {formatCurrency(store.t12AskingAdj)}
                        </div>
                        <div className="p-2 border-r text-center font-mono bg-green-50">
                          {formatCurrency(store.t12Asking)}
                        </div>
                        <div className="p-2 border-r text-center font-mono bg-amber-50">
                          {formatCurrency(store.t12InStore)}
                        </div>
                        <div className="p-2 border-r text-center font-mono bg-blue-50">
                          {formatCurrency(store.t6AskingAdj)}
                        </div>
                        <div className="p-2 border-r text-center font-mono bg-green-50">
                          {formatCurrency(store.t6Asking)}
                        </div>
                        <div className="p-2 border-r text-center font-mono bg-amber-50">
                          {formatCurrency(store.t6InStore)}
                        </div>
                        <div className="p-2 border-r text-center font-mono bg-blue-50">
                          {formatCurrency(store.t3AskingAdj)}
                        </div>
                        <div className="p-2 border-r text-center font-mono bg-green-50">
                          {formatCurrency(store.t3Asking)}
                        </div>
                        <div className="p-2 border-r text-center font-mono bg-amber-50">
                          {formatCurrency(store.t3InStore)}
                        </div>
                        <div className="p-2 border-r text-center font-mono bg-blue-50">
                          {formatCurrency(store.t1AskingAdj)}
                        </div>
                        <div className="p-2 border-r text-center font-mono bg-green-50">
                          {formatCurrency(store.t1Asking)}
                        </div>
                        <div className="p-2 text-center font-mono bg-amber-50">
                          {formatCurrency(store.t1InStore)}
                        </div>
                      </div>
                    ))}

                    {/* Average Row */}
                    <div className="grid grid-cols-[280px,55px,50px,70px,70px,70px,70px,70px,70px,70px,70px,70px,70px,70px,70px] bg-slate-300 border-b-2 border-slate-400 text-xs font-bold">
                      <div className="p-2 border-r pl-6">Average</div>
                      <div className="p-2 border-r"></div>
                      <div className="p-2 border-r"></div>
                      <div className="p-2 border-r text-center font-mono bg-blue-200">
                        {formatCurrency(group.averages.t12AskingAdj)}
                      </div>
                      <div className="p-2 border-r text-center font-mono bg-green-200">
                        {formatCurrency(group.averages.t12Asking)}
                      </div>
                      <div className="p-2 border-r text-center font-mono bg-amber-200">
                        {formatCurrency(group.averages.t12InStore)}
                      </div>
                      <div className="p-2 border-r text-center font-mono bg-blue-200">
                        {formatCurrency(group.averages.t6AskingAdj)}
                      </div>
                      <div className="p-2 border-r text-center font-mono bg-green-200">
                        {formatCurrency(group.averages.t6Asking)}
                      </div>
                      <div className="p-2 border-r text-center font-mono bg-amber-200">
                        {formatCurrency(group.averages.t6InStore)}
                      </div>
                      <div className="p-2 border-r text-center font-mono bg-blue-200">
                        {formatCurrency(group.averages.t3AskingAdj)}
                      </div>
                      <div className="p-2 border-r text-center font-mono bg-green-200">
                        {formatCurrency(group.averages.t3Asking)}
                      </div>
                      <div className="p-2 border-r text-center font-mono bg-amber-200">
                        {formatCurrency(group.averages.t3InStore)}
                      </div>
                      <div className="p-2 border-r text-center font-mono bg-blue-200">
                        {formatCurrency(group.averages.t1AskingAdj)}
                      </div>
                      <div className="p-2 border-r text-center font-mono bg-green-200">
                        {formatCurrency(group.averages.t1Asking)}
                      </div>
                      <div className="p-2 text-center font-mono bg-amber-200">
                        {formatCurrency(group.averages.t1InStore)}
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        </ScrollArea>
      )}

      {/* Store-Specific Tasks Section */}
      {applicableTasks.length > 0 && (
        <Card className="mt-6 border-purple-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-purple-700">
              <Settings2 className="w-5 h-5" />
              Store-Specific Adjustments
            </CardTitle>
            <CardDescription>
              Apply predefined rate adjustments for specific store types
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {applicableTasks.map(task => (
                <div
                  key={task.id}
                  className={`p-4 border rounded-lg flex items-center justify-between ${
                    appliedTasks.has(task.id) ? 'bg-green-50 border-green-200' : 'bg-purple-50 border-purple-200'
                  }`}
                >
                  <div className="flex-1">
                    <div className="font-medium">{task.name}</div>
                    <div className="text-sm text-muted-foreground">{task.description}</div>
                  </div>
                  <div className="ml-4">
                    {appliedTasks.has(task.id) ? (
                      <Badge variant="default" className="bg-green-600">Applied</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleApplyTask(task)}
                      >
                        Apply {task.multiplier}x
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Task Confirmation Dialog */}
      <Dialog open={pendingTask !== null} onOpenChange={() => setPendingTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Rate Adjustment</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground mb-4">
              Are you sure you want to apply this adjustment?
            </p>
            {pendingTask && (
              <div className="p-4 bg-muted rounded-lg">
                <div className="font-medium">{pendingTask.name}</div>
                <div className="text-sm text-muted-foreground mt-1">
                  This will multiply all rates by <strong>{pendingTask.multiplier}x</strong> for stores matching "{pendingTask.storePattern}"
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPendingTask(null)}>
              Cancel
            </Button>
            <Button onClick={confirmApplyTask}>
              Confirm & Apply
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Outlier Analysis Section */}
      {outliers.length > 0 && (
        <Card className="mt-6 border-amber-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="w-5 h-5" />
              Outlier Analysis ({outliers.length} detected)
            </CardTitle>
            <CardDescription>
              Review potential outliers in the rate data. Confirm to keep or exclude from analysis.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {outliers.slice(0, 10).map((outlier, idx) => (
                <div
                  key={idx}
                  className={`p-3 border rounded-lg flex items-center justify-between ${
                    outlier.confirmed === true
                      ? 'bg-green-50 border-green-200'
                      : outlier.confirmed === false
                      ? 'bg-red-50 border-red-200'
                      : 'bg-amber-50 border-amber-200'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {customNames[outlier.record.storeId] || outlier.record.storeName} - {outlier.record.size}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {outlier.reason}
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    {outlier.confirmed === null ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-green-700 border-green-300 hover:bg-green-100"
                          onClick={() => handleOutlierDecision(idx, true)}
                        >
                          Keep
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-700 border-red-300 hover:bg-red-100"
                          onClick={() => handleOutlierDecision(idx, false)}
                        >
                          Exclude
                        </Button>
                      </>
                    ) : (
                      <Badge variant={outlier.confirmed ? 'default' : 'destructive'}>
                        {outlier.confirmed ? 'Keeping' : 'Excluding'}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
              {outliers.length > 10 && (
                <p className="text-sm text-muted-foreground text-center">
                  And {outliers.length - 10} more outliers...
                </p>
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                onClick={applyOutlierExclusions}
                disabled={outliers.every(o => o.confirmed === null)}
              >
                Apply Decisions
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Export/Import Section */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileDown className="w-5 h-5" />
            Data Export & Import
          </CardTitle>
          <CardDescription>
            Download data for editing, then upload your changes
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Hidden file input for upload */}
          <input
            type="file"
            ref={fileInputRef}
            accept=".csv"
            onChange={handleFileUpload}
            className="hidden"
          />

          <Alert className="border-blue-200 bg-blue-50">
            <AlertTriangle className="h-4 w-4 text-blue-600" />
            <AlertTitle className="text-blue-800">Edit Workflow</AlertTitle>
            <AlertDescription className="text-blue-700">
              1. Download the data dump CSV → 2. Edit in Excel/Google Sheets → 3. Upload the edited CSV to update the analysis
            </AlertDescription>
          </Alert>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-4 border rounded-lg space-y-3">
              <h4 className="font-medium">Download Data Dump</h4>
              <p className="text-sm text-muted-foreground">
                Complete rate records with all details. Edit this file and re-upload.
              </p>
              <Button
                variant="outline"
                onClick={onDownloadDataDump}
                disabled={isLoading || rateRecords.length === 0}
                className="w-full"
              >
                <FileDown className="mr-2 h-4 w-4" />
                Download CSV
              </Button>
            </div>
            <div className="p-4 border rounded-lg space-y-3">
              <h4 className="font-medium">Upload Edited CSV</h4>
              <p className="text-sm text-muted-foreground">
                Upload your edited CSV to update rate records and recalculate.
              </p>
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                className="w-full"
              >
                <FileUp className="mr-2 h-4 w-4" />
                Upload CSV
              </Button>
            </div>
          </div>

          <div className="border-t pt-4">
            <Button onClick={onExport} disabled={isLoading} className="w-full" size="lg">
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating Reports...
                </>
              ) : (
                <>
                  <FileDown className="mr-2 h-4 w-4" />
                  Export Final RCA Template
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="mt-8 flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button variant="ghost" onClick={() => window.location.reload()}>
          Start New Analysis
        </Button>
      </div>
    </div>
  );
}
