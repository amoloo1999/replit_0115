import { Percent, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { AdjustmentFactors } from '@/types/rca';

const ADJUSTMENT_INFO = {
  captiveMarketPremium: 'Additional premium for captive market locations (e.g., apartment complexes, military bases)',
  lossToLease: 'Adjustment for existing below-market leases',
  ccAdj: 'Climate control adjustment factor',
};

interface StepAdjustmentsProps {
  factors: AdjustmentFactors;
  onUpdate: (factors: Partial<AdjustmentFactors>) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepAdjustments({ factors, onUpdate, onNext, onBack }: StepAdjustmentsProps) {
  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-semibold mb-2">Adjustment Factors</h2>
        <p className="text-muted-foreground">
          Set additional pricing adjustment factors (enter as percentages)
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Percent className="w-5 h-5" />
            Rate Adjustments
          </CardTitle>
          <CardDescription>
            These factors will be applied to competitor rates during analysis
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="captiveMarket">Captive Market Premium</Label>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="w-4 h-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">{ADJUSTMENT_INFO.captiveMarketPremium}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="relative">
                <Input
                  id="captiveMarket"
                  type="number"
                  step="0.1"
                  placeholder="0.0"
                  value={factors.captiveMarketPremium || ''}
                  onChange={(e) => onUpdate({ captiveMarketPremium: parseFloat(e.target.value) || 0 })}
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="lossToLease">Loss to Lease</Label>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="w-4 h-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">{ADJUSTMENT_INFO.lossToLease}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="relative">
                <Input
                  id="lossToLease"
                  type="number"
                  step="0.1"
                  placeholder="0.0"
                  value={factors.lossToLease || ''}
                  onChange={(e) => onUpdate({ lossToLease: parseFloat(e.target.value) || 0 })}
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="ccAdj">CC Adjustment</Label>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="w-4 h-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">{ADJUSTMENT_INFO.ccAdj}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="relative">
                <Input
                  id="ccAdj"
                  type="number"
                  step="0.1"
                  placeholder="0.0"
                  value={factors.ccAdj || ''}
                  onChange={(e) => onUpdate({ ccAdj: parseFloat(e.target.value) || 0 })}
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
              </div>
            </div>
          </div>

          <div className="p-4 bg-muted/50 rounded-lg">
            <h4 className="font-medium mb-2">Summary</h4>
            <div className="text-sm text-muted-foreground space-y-1">
              <p>Captive Market Premium: <span className="font-mono">{factors.captiveMarketPremium || 0}%</span></p>
              <p>Loss to Lease: <span className="font-mono">{factors.lossToLease || 0}%</span></p>
              <p>CC Adjustment: <span className="font-mono">{factors.ccAdj || 0}%</span></p>
              <hr className="my-2 border-border" />
              <p className="font-medium text-foreground">
                Total Additional Adjustment:{' '}
                <span className="font-mono">
                  {((factors.captiveMarketPremium || 0) + (factors.lossToLease || 0) + (factors.ccAdj || 0)).toFixed(1)}%
                </span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mt-8 flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext}>
          Continue to Names
        </Button>
      </div>
    </div>
  );
}
