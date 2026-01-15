import { useEffect } from 'react';
import { Tag, Info } from 'lucide-react';
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
  onUpdate: (tag: string, code: string) => void;
  onInitialize: () => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepFeatureCodes({ featureCodes, onUpdate, onInitialize, onNext, onBack }: StepFeatureCodesProps) {
  useEffect(() => {
    if (featureCodes.length === 0) {
      onInitialize();
    }
  }, [featureCodes.length, onInitialize]);

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-semibold mb-2">Assign Feature Codes</h2>
        <p className="text-muted-foreground">
          Assign codes to each unique unit classification for the CSV export
        </p>
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
            {featureCodes.map((fc, index) => (
              <div key={fc.originalTag} className="space-y-2 p-4 bg-muted/30 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Tag {index + 1}</span>
                  <Badge variant="secondary">{fc.count} records</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{fc.originalTag}</p>
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
            ))}
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
