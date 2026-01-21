import { useEffect, useState } from 'react';
import { Tag, Info, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { FeatureCode } from '@/types/rca';

const PRESET_CODES = [
  { code: 'GLCC', label: 'Ground Level Climate Controlled' },
  { code: 'GNCC', label: 'Ground Level Non-Climate Controlled' },
  { code: 'ECC', label: 'Elevator Climate Controlled' },
  { code: 'ENCC', label: 'Elevator Non-Climate Controlled' },
  { code: 'DUCC', label: 'Drive-Up Climate Controlled' },
  { code: 'DU', label: 'Drive-Up (Non-Climate)' },
  { code: 'ICC', label: 'Interior Climate Controlled' },
  { code: 'INCC', label: 'Interior Non-Climate Controlled' },
  { code: 'CC', label: 'Climate Controlled (generic)' },
  { code: 'NCC', label: 'Non-Climate Controlled (generic)' },
];

interface StepFeatureCodesProps {
  featureCodes: FeatureCode[];
  rateRecordCount?: number;
  onUpdate: (tag: string, code: string) => void;
  onInitialize: () => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepFeatureCodes({ featureCodes, rateRecordCount = 0, onUpdate, onInitialize, onNext, onBack }: StepFeatureCodesProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRecordCount, setLastRecordCount] = useState(0);

  // Initialize on first mount or when no feature codes exist
  useEffect(() => {
    if (featureCodes.length === 0) {
      onInitialize();
    }
  }, [featureCodes.length, onInitialize]);

  // Track rate record count and auto-refresh if it changed significantly
  // This happens when user fills data gaps and returns to this page
  useEffect(() => {
    if (rateRecordCount > 0 && lastRecordCount > 0 && rateRecordCount !== lastRecordCount) {
      // Records changed (likely from API fetch), refresh feature codes
      console.log(`Rate records changed from ${lastRecordCount} to ${rateRecordCount}, refreshing feature codes`);
      onInitialize();
    }
    setLastRecordCount(rateRecordCount);
  }, [rateRecordCount, lastRecordCount, onInitialize]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await onInitialize();
    setIsRefreshing(false);
  };

  // Calculate total records from feature codes
  const totalRecords = featureCodes.reduce((sum, fc) => sum + fc.count, 0);

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-semibold mb-2">Assign Feature Codes</h2>
        <p className="text-muted-foreground">
          Assign codes to each unique unit classification for the CSV export
        </p>
        {totalRecords > 0 && (
          <div className="mt-2 flex items-center justify-center gap-2">
            <Badge variant="secondary" className="text-sm">
              {totalRecords.toLocaleString()} total rate records
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="h-7 px-2"
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        )}
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="w-4 h-4" />
            Available Preset Codes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {PRESET_CODES.map(({ code, label }) => (
              <Badge key={code} variant="outline" className="text-xs">
                <span className="font-mono font-bold mr-1">{code}</span>
                <span className="text-muted-foreground">= {label}</span>
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="w-5 h-5" />
            Unit Classifications
          </CardTitle>
          <CardDescription>
            Select a preset code or enter a custom code for each tag
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {featureCodes.map((fc, index) => {
              // Check if this tag has conflicting/multiple features (indicated by + in the tag)
              const hasMultipleFeatures = fc.originalTag.includes('+');

              return (
                <div
                  key={fc.originalTag}
                  className={`space-y-2 p-4 rounded-lg ${
                    hasMultipleFeatures
                      ? 'bg-amber-50 border border-amber-200'
                      : 'bg-muted/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Tag {index + 1}</span>
                      {hasMultipleFeatures && (
                        <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-100">
                          Multiple Features
                        </Badge>
                      )}
                    </div>
                    <Badge variant="secondary">{fc.count.toLocaleString()} records</Badge>
                  </div>
                  <p className={`text-sm ${hasMultipleFeatures ? 'text-amber-800 font-medium' : 'text-muted-foreground'}`}>
                    {fc.originalTag}
                  </p>
                  {hasMultipleFeatures && (
                    <p className="text-xs text-amber-600">
                      This tag has multiple access types. Please select the appropriate code for these records.
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Select
                      value={PRESET_CODES.some((p) => p.code === fc.code) ? fc.code : 'custom'}
                      onValueChange={(value) => {
                        if (value !== 'custom') {
                          onUpdate(fc.originalTag, value);
                        }
                      }}
                    >
                      <SelectTrigger className="w-48">
                        <SelectValue placeholder="Select code" />
                      </SelectTrigger>
                      <SelectContent>
                        {PRESET_CODES.map(({ code, label }) => (
                          <SelectItem key={code} value={code}>
                            <span className="font-mono font-bold">{code}</span>
                          </SelectItem>
                        ))}
                        <SelectItem value="custom">Custom...</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={fc.code}
                      onChange={(e) => onUpdate(fc.originalTag, e.target.value.toUpperCase())}
                      placeholder="Custom code"
                      className="flex-1 font-mono uppercase"
                      maxLength={10}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="mt-8 flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext}>
          Continue to Export
        </Button>
      </div>
    </div>
  );
}
