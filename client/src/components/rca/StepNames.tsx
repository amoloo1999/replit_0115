import { Edit3, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Store } from '@/types/rca';

interface StepNamesProps {
  stores: Store[];
  customNames: Record<number, string>;
  onUpdate: (storeId: number, name: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepNames({ stores, customNames, onUpdate, onNext, onBack }: StepNamesProps) {
  const resetName = (store: Store) => {
    onUpdate(store.storeId, store.storeName);
  };

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-semibold mb-2">Customize Store Names</h2>
        <p className="text-muted-foreground">
          Edit how store names will appear in the CSV export
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Edit3 className="w-5 h-5" />
            Display Names
          </CardTitle>
          <CardDescription>
            Press Enter to keep original name, or type a custom name
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {stores.map((store, index) => {
              const isSubject = index === 0;
              const currentName = customNames[store.storeId] || store.storeName;
              const isModified = currentName !== store.storeName;
              
              return (
                <div key={store.storeId} className="space-y-2">
                  <div className="flex items-center gap-2">
                    {isSubject && <Badge variant="default" className="shrink-0">Subject</Badge>}
                    {!isSubject && <Badge variant="outline" className="shrink-0">Comp {index}</Badge>}
                    <span className="text-sm text-muted-foreground">Original: {store.storeName}</span>
                    {isModified && (
                      <Badge variant="secondary" className="ml-auto">Modified</Badge>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={currentName}
                      onChange={(e) => onUpdate(store.storeId, e.target.value)}
                      placeholder={store.storeName}
                      className="flex-1"
                    />
                    {isModified && (
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => resetName(store)}
                        title="Reset to original"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </Button>
                    )}
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
          Continue to Data Gaps
        </Button>
      </div>
    </div>
  );
}
