import { useState } from 'react';
import { Star, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { Store, StoreRankings, StoreMetadata } from '@/types/rca';

const RANKING_CATEGORIES = [
  { key: 'Location', description: 'Proximity to population centers, traffic patterns, accessibility' },
  { key: 'Accessibility', description: 'Ease of access, parking, gate hours' },
  { key: 'VPD', description: 'Vehicles Per Day passing the location' },
  { key: 'Visibility & Signage', description: 'Street visibility, signage quality' },
  { key: 'Brand', description: 'Brand recognition and reputation' },
  { key: 'Quality', description: 'Facility condition and maintenance' },
] as const;

interface StepRankingsProps {
  stores: Store[];
  rankings: Record<number, StoreRankings>;
  metadata: Record<number, StoreMetadata>;
  onUpdate: (storeId: number, rankings: Partial<StoreRankings>) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepRankings({ stores, rankings, metadata, onUpdate, onNext, onBack }: StepRankingsProps) {
  const [activeStore, setActiveStore] = useState(stores[0]?.storeId.toString() || '');

  const calculateAgeRanking = (yearBuilt: number | null): number => {
    if (!yearBuilt) return 5;
    const age = new Date().getFullYear() - yearBuilt;
    if (age <= 10) return 10;
    if (age <= 20) return 9;
    if (age <= 30) return 8;
    if (age <= 40) return 7;
    if (age <= 50) return 6;
    return 5;
  };

  const calculateSizeRanking = (sf: number | null): number => {
    if (!sf) return 7;
    if (sf <= 50000) return 10;
    if (sf <= 60000) return 9;
    if (sf <= 70000) return 8;
    if (sf <= 80000) return 7;
    if (sf <= 90000) return 6;
    if (sf <= 100000) return 5;
    return 4;
  };

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-semibold mb-2">Store Rankings</h2>
        <p className="text-muted-foreground">
          Rate each store on a scale of 1-10 (10 = best/most competitive)
        </p>
      </div>

      <Tabs value={activeStore} onValueChange={setActiveStore}>
        <TabsList className="w-full flex-wrap h-auto gap-2 bg-transparent p-0 mb-6">
          {stores.map((store, index) => (
            <TabsTrigger
              key={store.storeId}
              value={store.storeId.toString()}
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground px-4"
            >
              {index === 0 ? 'Subject' : `Comp ${index}`}
            </TabsTrigger>
          ))}
        </TabsList>

        {stores.map((store, index) => {
          const storeRankings = rankings[store.storeId];
          const storeMeta = metadata[store.storeId];
          const isSubject = index === 0;
          const ageRank = calculateAgeRanking(storeMeta?.yearBuilt);
          const sizeRank = calculateSizeRanking(storeMeta?.squareFootage);

          return (
            <TabsContent key={store.storeId} value={store.storeId.toString()}>
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    {isSubject && <Badge variant="default">Subject</Badge>}
                    <CardTitle>{store.storeName}</CardTitle>
                  </div>
                  <CardDescription>
                    {store.address}, {store.city} • {storeMeta?.distance ? `${storeMeta.distance} mi` : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Auto-calculated rankings */}
                  <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">Age</span>
                        <span className="text-sm text-muted-foreground">Auto-calculated</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-primary transition-all"
                            style={{ width: `${ageRank * 10}%` }}
                          />
                        </div>
                        <span className="font-mono text-lg font-semibold w-8 text-right">{ageRank}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Based on Year Built: {storeMeta?.yearBuilt || 'Not set'}
                      </p>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">Size</span>
                        <span className="text-sm text-muted-foreground">Auto-calculated</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-primary transition-all"
                            style={{ width: `${sizeRank * 10}%` }}
                          />
                        </div>
                        <span className="font-mono text-lg font-semibold w-8 text-right">{sizeRank}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Based on SF: {storeMeta?.squareFootage?.toLocaleString() || 'Not set'}
                      </p>
                    </div>
                  </div>

                  {/* Manual rankings */}
                  <div className="space-y-5">
                    {RANKING_CATEGORIES.map(({ key, description }) => (
                      <div key={key}>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{key}</span>
                            <Tooltip>
                              <TooltipTrigger>
                                <Info className="w-4 h-4 text-muted-foreground" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="max-w-xs">{description}</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <span className="font-mono text-lg font-semibold">
                            {storeRankings?.[key as keyof StoreRankings] || 5}
                          </span>
                        </div>
                        <Slider
                          value={[storeRankings?.[key as keyof StoreRankings] || 5]}
                          onValueChange={([value]) => onUpdate(store.storeId, { [key]: value })}
                          min={1}
                          max={10}
                          step={1}
                          className="py-1"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground mt-1">
                          <span>1 (Worst)</span>
                          <span>10 (Best)</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>

      <div className="mt-8 flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext}>
          Continue to Adjustments
        </Button>
      </div>
    </div>
  );
}
