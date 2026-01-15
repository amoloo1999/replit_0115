import { Building2, MapPin, Phone, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Store } from '@/types/rca';

interface StepSubjectStoreProps {
  stores: Store[];
  selectedStore: Store | null;
  onSelect: (store: Store) => void;
  onNext: () => void;
  isLoading?: boolean;
}

export function StepSubjectStore({ stores, selectedStore, onSelect, onNext, isLoading }: StepSubjectStoreProps) {
  const getStatusLabel = (status?: number) => {
    switch (status) {
      case 1: return { label: 'Rates Available', variant: 'default' as const };
      case 2: return { label: 'Website Only', variant: 'secondary' as const };
      case 3: return { label: 'No Data', variant: 'outline' as const };
      default: return { label: 'Unknown', variant: 'outline' as const };
    }
  };

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-semibold mb-2">Select Subject Store</h2>
        <p className="text-muted-foreground">
          Found {stores.length} store{stores.length !== 1 ? 's' : ''} matching your search. Select your subject store.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {stores.map((store) => {
          const isSelected = selectedStore?.storeId === store.storeId;
          const status = getStatusLabel(store.storeStatus);
          
          return (
            <Card
              key={store.storeId}
              className={cn(
                'cursor-pointer transition-all duration-200 hover:shadow-elevated',
                isSelected && 'ring-2 ring-primary shadow-elevated'
              )}
              onClick={() => onSelect(store)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex-1 pr-4">
                    <CardTitle className="text-base font-medium leading-tight">
                      {store.storeName}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      ID: {store.storeId}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={status.variant}>{status.label}</Badge>
                    {isSelected && (
                      <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                        <Check className="w-4 h-4 text-primary-foreground" />
                      </div>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-start gap-2 text-sm">
                  <MapPin className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                  <span>
                    {store.address}<br />
                    {store.city}, {store.state} {store.zip}
                  </span>
                </div>
                {store.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <span>{store.phone}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-8 flex justify-end">
        <Button onClick={onNext} disabled={!selectedStore || isLoading} size="lg">
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Finding Competitors...
            </>
          ) : (
            'Continue with Selected Store'
          )}
        </Button>
      </div>
    </div>
  );
}
