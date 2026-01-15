import { useState } from 'react';
import { Building2, Calendar, Ruler, Search, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SalesforceMatchModal } from './SalesforceMatchModal';
import type { Store, StoreMetadata, SalesforceMatch } from '@/types/rca';

interface StepMetadataProps {
  stores: Store[];
  metadata: Record<number, StoreMetadata>;
  onUpdate: (storeId: number, data: Partial<StoreMetadata>) => void;
  onNext: () => void;
  onBack: () => void;
  onFetchMatches: (store: Store) => Promise<SalesforceMatch[]>;
}

export function StepMetadata({ 
  stores, 
  metadata, 
  onUpdate, 
  onNext, 
  onBack,
  onFetchMatches,
}: StepMetadataProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [currentMatches, setCurrentMatches] = useState<SalesforceMatch[]>([]);
  const [loadingStoreId, setLoadingStoreId] = useState<number | null>(null);

  const formatNumber = (value: number | null): string => {
    if (value === null) return '';
    return value.toLocaleString();
  };

  const parseNumber = (value: string): number | null => {
    const num = parseInt(value.replace(/,/g, ''), 10);
    return isNaN(num) ? null : num;
  };

  const handleVerifyClick = async (store: Store) => {
    setLoadingStoreId(store.storeId);
    setSelectedStore(store);
    
    try {
      const matches = await onFetchMatches(store);
      setCurrentMatches(matches);
      setModalOpen(true);
    } catch (error) {
      console.error('Failed to fetch matches:', error);
      setCurrentMatches([]);
      setModalOpen(true);
    } finally {
      setLoadingStoreId(null);
    }
  };

  const handleSelectMatch = (match: SalesforceMatch | null) => {
    if (!selectedStore) return;
    
    if (match) {
      // Parse Year_Built__c and Net_RSF__c
      let yearBuilt: number | null = null;
      let squareFootage: number | null = null;
      
      if (match.Year_Built__c) {
        const parsed = parseInt(String(match.Year_Built__c), 10);
        if (!isNaN(parsed) && parsed >= 1900 && parsed <= 2030) {
          yearBuilt = parsed;
        }
      }
      
      if (match.Net_RSF__c) {
        const parsed = parseFloat(String(match.Net_RSF__c));
        if (!isNaN(parsed) && parsed > 0) {
          squareFootage = parsed;
        }
      }
      
      onUpdate(selectedStore.storeId, { 
        yearBuilt, 
        squareFootage,
        salesforceMatch: match,
      });
    }
  };

  const handleManualEntry = (yearBuilt: number | null, squareFootage: number | null) => {
    if (!selectedStore) return;
    
    onUpdate(selectedStore.storeId, { 
      yearBuilt, 
      squareFootage,
      salesforceMatch: null, // Mark as manually entered
    });
  };

  const getMatchStatus = (storeMeta: StoreMetadata | undefined) => {
    if (!storeMeta) return 'none';
    if (storeMeta.salesforceMatch) return 'matched';
    if (storeMeta.yearBuilt || storeMeta.squareFootage) return 'manual';
    return 'none';
  };

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-semibold mb-2">Store Metadata</h2>
        <p className="text-muted-foreground">
          Verify Year Built and Square Footage from Salesforce or enter manually
        </p>
      </div>

      <div className="space-y-4">
        {stores.map((store, index) => {
          const storeMeta = metadata[store.storeId] || { yearBuilt: null, squareFootage: null };
          const isSubject = index === 0;
          const matchStatus = getMatchStatus(storeMeta);
          const isLoading = loadingStoreId === store.storeId;
          
          return (
            <Card key={store.storeId} className={isSubject ? 'border-primary/30' : ''}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isSubject && <Badge variant="default">Subject</Badge>}
                    {!isSubject && <Badge variant="outline">Competitor {index}</Badge>}
                    <span className="text-sm text-muted-foreground">ID: {store.storeId}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {matchStatus === 'matched' && (
                      <Badge variant="default" className="bg-green-600">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        SF Verified
                      </Badge>
                    )}
                    {matchStatus === 'manual' && (
                      <Badge variant="secondary">
                        Manual Entry
                      </Badge>
                    )}
                    {matchStatus === 'none' && (
                      <Badge variant="outline" className="text-amber-600 border-amber-600">
                        <AlertCircle className="w-3 h-3 mr-1" />
                        Needs Data
                      </Badge>
                    )}
                  </div>
                </div>
                <CardTitle className="text-base">{store.storeName}</CardTitle>
                <CardDescription>{store.address}, {store.city}, {store.state} {store.zip}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor={`year-${store.storeId}`} className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      Year Built
                    </Label>
                    <Input
                      id={`year-${store.storeId}`}
                      type="number"
                      min="1900"
                      max="2030"
                      placeholder="e.g., 2015"
                      value={storeMeta.yearBuilt || ''}
                      onChange={(e) => onUpdate(store.storeId, { yearBuilt: parseNumber(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`sf-${store.storeId}`} className="flex items-center gap-2">
                      <Ruler className="w-4 h-4 text-muted-foreground" />
                      Square Footage
                    </Label>
                    <Input
                      id={`sf-${store.storeId}`}
                      type="text"
                      placeholder="e.g., 75,000"
                      value={formatNumber(storeMeta.squareFootage)}
                      onChange={(e) => onUpdate(store.storeId, { squareFootage: parseNumber(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-transparent">
                      <Search className="w-4 h-4" />
                      Verify
                    </Label>
                    <Button 
                      variant="outline" 
                      className="w-full"
                      onClick={() => handleVerifyClick(store)}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Searching...
                        </>
                      ) : (
                        <>
                          <Search className="w-4 h-4 mr-2" />
                          Find in Salesforce
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                
                {storeMeta.salesforceMatch && (
                  <div className="mt-3 p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-900">
                    <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                      <CheckCircle2 className="w-4 h-4" />
                      <span className="font-medium">Matched:</span>
                      <span>{storeMeta.salesforceMatch.Name}</span>
                      <span className="text-green-600 dark:text-green-500">
                        ({Math.round(storeMeta.salesforceMatch.combinedScore * 100)}% confidence)
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-8 flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext}>
          Continue to Rankings
        </Button>
      </div>

      {selectedStore && (
        <SalesforceMatchModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          store={selectedStore}
          matches={currentMatches}
          onSelectMatch={handleSelectMatch}
          onManualEntry={handleManualEntry}
        />
      )}
    </div>
  );
}
