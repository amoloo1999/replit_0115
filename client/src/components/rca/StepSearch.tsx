import { useState } from 'react';
import { Search, MapPin, Building2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SearchCriteria } from '@/types/rca';

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

interface StepSearchProps {
  criteria: SearchCriteria;
  onUpdate: (criteria: Partial<SearchCriteria>) => void;
  onSearch: () => void;
  isLoading: boolean;
}

export function StepSearch({ criteria, onUpdate, onSearch, isLoading }: StepSearchProps) {
  const [errors, setErrors] = useState<Partial<Record<keyof SearchCriteria, string>>>({});

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof SearchCriteria, string>> = {};
    
    if (!criteria.city.trim()) {
      newErrors.city = 'City is required';
    }
    if (!criteria.state) {
      newErrors.state = 'State is required';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onSearch();
    }
  };

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <Card className="shadow-card">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <MapPin className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl">Search Location</CardTitle>
              <CardDescription>Enter address details to find your subject store</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="streetAddress">Street Address</Label>
                <Input
                  id="streetAddress"
                  placeholder="e.g., 123 Main St"
                  value={criteria.streetAddress}
                  onChange={(e) => onUpdate({ streetAddress: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">
                    City <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="city"
                    placeholder="e.g., Los Angeles"
                    value={criteria.city}
                    onChange={(e) => {
                      onUpdate({ city: e.target.value });
                      if (errors.city) setErrors({ ...errors, city: undefined });
                    }}
                    className={errors.city ? 'border-destructive' : ''}
                  />
                  {errors.city && (
                    <p className="text-xs text-destructive">{errors.city}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">
                    State <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={criteria.state}
                    onValueChange={(value) => {
                      onUpdate({ state: value });
                      if (errors.state) setErrors({ ...errors, state: undefined });
                    }}
                  >
                    <SelectTrigger className={errors.state ? 'border-destructive' : ''}>
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent>
                      {US_STATES.map((state) => (
                        <SelectItem key={state} value={state}>
                          {state}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.state && (
                    <p className="text-xs text-destructive">{errors.state}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="zipCode">ZIP Code</Label>
                  <Input
                    id="zipCode"
                    placeholder="e.g., 90001"
                    value={criteria.zipCode}
                    onChange={(e) => onUpdate({ zipCode: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="radius">Search Radius (miles)</Label>
                  <Select
                    value={String(criteria.radius)}
                    onValueChange={(value) => onUpdate({ radius: Number(value) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 5, 7, 10, 15, 20].map((r) => (
                        <SelectItem key={r} value={String(r)}>
                          {r} miles
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t space-y-4">
              <p className="text-sm text-muted-foreground">Optional filters</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="storeName" className="flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    Store Name
                  </Label>
                  <Input
                    id="storeName"
                    placeholder="Filter by name"
                    value={criteria.storeName}
                    onChange={(e) => onUpdate({ storeName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="companyName" className="flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    Company Name
                  </Label>
                  <Input
                    id="companyName"
                    placeholder="Filter by company"
                    value={criteria.companyName}
                    onChange={(e) => onUpdate({ companyName: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Searching...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  Search Stores
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
