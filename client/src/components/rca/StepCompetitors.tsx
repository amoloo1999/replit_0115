import { useState } from 'react';
import { Building2, MapPin, Navigation, Check, CheckSquare, Square, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { Store } from '@/types/rca';

interface StepCompetitorsProps {
  subjectStore: Store;
  competitors: Store[];
  onSelect: (stores: Store[]) => Promise<void>;
  onNext: () => void;
  onBack: () => void;
  isLoading?: boolean;
}

export function StepCompetitors({ subjectStore, competitors, onSelect, onNext, onBack, isLoading }: StepCompetitorsProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isFetchingMetadata, setIsFetchingMetadata] = useState(false);

  const toggleStore = (storeId: number) => {
    const newSelected = new Set(selected);
    if (newSelected.has(storeId)) {
      newSelected.delete(storeId);
    } else {
      newSelected.add(storeId);
    }
    setSelected(newSelected);
  };

  const selectAll = () => {
    setSelected(new Set(competitors.map((c) => c.storeId)));
  };

  const selectNone = () => {
    setSelected(new Set());
  };

  const handleContinue = async () => {
    const selectedStores = competitors.filter((c) => selected.has(c.storeId));
    setIsFetchingMetadata(true);
    await onSelect(selectedStores);
    setIsFetchingMetadata(false);
    onNext();
  };

  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      {/* Subject Store Banner */}
      <Card className="mb-6 border-primary/30 bg-primary/5">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Badge variant="default">Subject Store</Badge>
          </div>
          <CardTitle className="text-lg">{subjectStore.storeName}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="w-4 h-4" />
            <span>{subjectStore.address}, {subjectStore.city}, {subjectStore.state} {subjectStore.zip}</span>
          </div>
        </CardContent>
      </Card>

      {/* Competitors Section */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold">Competitors ({competitors.length})</h2>
            <p className="text-sm text-muted-foreground">
              Select competitors to include in your rate analysis
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={selectAll}>
              <CheckSquare className="w-4 h-4 mr-2" />
              Select All
            </Button>
            <Button variant="outline" size="sm" onClick={selectNone}>
              <Square className="w-4 h-4 mr-2" />
              Clear
            </Button>
          </div>
        </div>

        <div className="grid gap-3">
          {competitors.map((store, index) => {
            const isSelected = selected.has(store.storeId);
            
            return (
              <Card
                key={store.storeId}
                className={cn(
                  'cursor-pointer transition-all duration-200',
                  isSelected && 'ring-2 ring-primary bg-primary/5'
                )}
                onClick={() => toggleStore(store.storeId)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-3">
                      <Checkbox 
                        checked={isSelected}
                        onCheckedChange={() => toggleStore(store.storeId)}
                      />
                      <span className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
                        {index + 1}
                      </span>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium truncate">{store.storeName}</h3>
                        <Badge variant="outline" className="shrink-0">
                          ID: {store.storeId}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {store.address}, {store.city}
                        </span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="flex items-center gap-1 text-primary font-medium">
                        <Navigation className="w-4 h-4" />
                        <span>{(store.distance || 0).toFixed(2)} mi</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Selection Summary */}
      <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t py-4 -mx-4 px-4 mt-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="text-sm">
            <span className="font-medium">{selected.size}</span> competitor{selected.size !== 1 ? 's' : ''} selected
            {selected.size > 0 && (
              <span className="text-muted-foreground"> + 1 subject store = {selected.size + 1} total stores</span>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onBack}>
              Back
            </Button>
            <Button onClick={handleContinue} disabled={selected.size === 0 || isFetchingMetadata}>
              {isFetchingMetadata ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Fetching Metadata...
                </>
              ) : (
                'Continue to Metadata'
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
