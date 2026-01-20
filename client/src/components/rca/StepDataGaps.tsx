import { useState, useEffect } from 'react';
import { Database, AlertTriangle, Check, DollarSign, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import type { DateGap } from '@/types/rca';

interface StepDataGapsProps {
  gaps: DateGap[];
  selectedApiStores: number[];
  onSetApiStores: (ids: number[]) => void;
  onAnalyze: () => void;
  isLoading: boolean;
  onNext: () => void;
  onBack: () => void;
}

export function StepDataGaps({
  gaps,
  selectedApiStores,
  onSetApiStores,
  onAnalyze,
  isLoading,
  onNext,
  onBack
}: StepDataGapsProps) {
  // Auto-analyze when entering this step with no gaps data
  useEffect(() => {
    if (gaps.length === 0 && !isLoading) {
      onAnalyze();
    }
  }, [gaps.length, isLoading, onAnalyze]);

  const storesWithGaps = gaps.filter((g) => g.missingDays > 0);
  const totalCost = storesWithGaps
    .filter((g) => selectedApiStores.includes(g.storeId))
    .reduce((sum, g) => sum + g.estimatedCost, 0);

  const toggleStore = (storeId: number) => {
    if (selectedApiStores.includes(storeId)) {
      onSetApiStores(selectedApiStores.filter((id) => id !== storeId));
    } else {
      onSetApiStores([...selectedApiStores, storeId]);
    }
  };

  const selectAllGaps = () => {
    onSetApiStores(storesWithGaps.map((g) => g.storeId));
  };

  const selectNone = () => {
    onSetApiStores([]);
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto animate-fade-in">
        <Card className="p-12">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Analyzing database coverage...</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-semibold mb-2">Database Coverage Analysis</h2>
        <p className="text-muted-foreground">
          Review data availability and select stores for API fetch
        </p>
      </div>

      <div className="space-y-4">
        {gaps.map((gap) => {
          const hasGaps = gap.missingDays > 0;
          const isSelected = selectedApiStores.includes(gap.storeId);
          
          return (
            <Card 
              key={gap.storeId}
              className={cn(
                hasGaps && isSelected && 'ring-2 ring-primary'
              )}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  {hasGaps && (
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleStore(gap.storeId)}
                      className="mt-1"
                    />
                  )}
                  {!hasGaps && (
                    <div className="w-4 h-4 mt-1 rounded-full bg-success flex items-center justify-center">
                      <Check className="w-3 h-3 text-success-foreground" />
                    </div>
                  )}
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-medium">{gap.storeName}</h3>
                      <Badge variant={hasGaps ? 'outline' : 'default'}>
                        ID: {gap.storeId}
                      </Badge>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Coverage:</span>
                        <Progress value={gap.coveragePercent} className="flex-1 h-2" />
                        <span className="text-sm font-mono w-16 text-right">{gap.coveragePercent}%</span>
                      </div>
                      
                      {hasGaps ? (
                        <div className="text-sm text-muted-foreground">
                          <span className="text-warning">{gap.missingDays} days</span> missing
                          {gap.dateRanges.length > 0 && (
                            <span> • Ranges: {gap.dateRanges.join(', ')}</span>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-success">Complete data available in database</p>
                      )}
                    </div>
                  </div>

                  {hasGaps && (
                    <div className="text-right shrink-0">
                      <p className="text-sm font-medium">${gap.estimatedCost.toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground">API cost</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {storesWithGaps.length > 0 && (
        <>
          <Alert className="mt-6 border-warning/50 bg-warning/10">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <AlertTitle>API Fetch Warning</AlertTitle>
            <AlertDescription>
              Fetching missing data via API incurs costs. Select stores carefully.
              API fetches are billed at $12.50 per year of historical data per store.
            </AlertDescription>
          </Alert>

          <div className="mt-4 flex items-center justify-between p-4 bg-muted rounded-lg">
            <div>
              <p className="font-medium">
                {selectedApiStores.length} of {storesWithGaps.length} stores selected for API fetch
              </p>
              <p className="text-sm text-muted-foreground">
                Estimated cost: <span className="font-mono font-medium">${totalCost.toFixed(2)}</span>
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={selectAllGaps}>
                Select All with Gaps
              </Button>
              <Button variant="outline" size="sm" onClick={selectNone}>
                Clear Selection
              </Button>
            </div>
          </div>
        </>
      )}

      {storesWithGaps.length === 0 && gaps.length > 0 && (
        <Alert className="mt-6 border-success/50 bg-success/10">
          <Check className="h-4 w-4 text-success" />
          <AlertTitle>Complete Coverage</AlertTitle>
          <AlertDescription>
            All selected stores have complete rate data in the database. No API fetch needed!
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-8 flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext}>
          Continue to Feature Codes
        </Button>
      </div>
    </div>
  );
}
