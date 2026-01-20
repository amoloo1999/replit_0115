import { useState } from 'react';
import { Check, Search, MapPin, Building2, Calendar, Ruler, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SalesforceMatch, Store } from '@/types/rca';

interface SalesforceMatchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store: Store;
  matches: SalesforceMatch[];
  onSelectMatch: (match: SalesforceMatch | null) => void;
  onManualEntry: (yearBuilt: number | null, squareFootage: number | null) => void;
}

export function SalesforceMatchModal({
  open,
  onOpenChange,
  store,
  matches,
  onSelectMatch,
  onManualEntry,
}: SalesforceMatchModalProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualYearBuilt, setManualYearBuilt] = useState<string>('');
  const [manualSquareFootage, setManualSquareFootage] = useState<string>('');

  const formatScore = (score: number) => `${Math.round(score * 100)}%`;
  
  const formatNumber = (value: string | number | null): string => {
    if (value === null || value === '') return 'N/A';
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return isNaN(num) ? 'N/A' : num.toLocaleString();
  };

  const handleSelectMatch = () => {
    if (selectedIndex !== null && matches[selectedIndex]) {
      onSelectMatch(matches[selectedIndex]);
      onOpenChange(false);
    }
  };

  const handleManualSubmit = () => {
    const yearBuilt = manualYearBuilt ? parseInt(manualYearBuilt, 10) : null;
    const squareFootage = manualSquareFootage ? parseFloat(manualSquareFootage.replace(/,/g, '')) : null;
    onManualEntry(
      yearBuilt && !isNaN(yearBuilt) ? yearBuilt : null,
      squareFootage && !isNaN(squareFootage) ? squareFootage : null
    );
    onOpenChange(false);
  };

  const handleNoMatch = () => {
    onSelectMatch(null);
    setManualMode(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" />
            Verify Salesforce Match
          </DialogTitle>
          <DialogDescription>
            Select the correct Salesforce record for <strong>{store.storeName}</strong>
            <br />
            <span className="text-xs">{store.address}, {store.city}, {store.state} {store.zip}</span>
          </DialogDescription>
        </DialogHeader>

        {!manualMode ? (
          <>
            {matches.length > 0 ? (
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-3">
                  {matches.map((match, index) => {
                    const isSelected = selectedIndex === index;
                    const yearBuilt = match.Year_Built__c;
                    const sqft = match.Net_RSF__c;
                    
                    return (
                      <div
                        key={index}
                        className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                          isSelected
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/50'
                        }`}
                        onClick={() => setSelectedIndex(index)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium">{match.Name}</span>
                              {index === 0 && match.addressScore >= 0.99 && (
                                <Badge variant="secondary" className="text-xs">
                                  Best Match
                                </Badge>
                              )}
                            </div>
                            
                            <div className="flex items-center gap-1 text-sm text-muted-foreground mb-2">
                              <MapPin className="w-3 h-3" />
                              {match.parsedAddress || 'No address'}
                            </div>
                            
                            <div className="grid grid-cols-3 gap-4 text-sm">
                              <div className="flex items-center gap-1">
                                <Calendar className="w-3 h-3 text-muted-foreground" />
                                <span className="text-muted-foreground">Year:</span>
                                <span className="font-medium">
                                  {yearBuilt || 'N/A'}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Ruler className="w-3 h-3 text-muted-foreground" />
                                <span className="text-muted-foreground">SF:</span>
                                <span className="font-medium">
                                  {formatNumber(sqft)}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Building2 className="w-3 h-3 text-muted-foreground" />
                                <span className="text-muted-foreground">Brand:</span>
                                <span className="font-medium">
                                  {match.parsedStoreName}
                                </span>
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex flex-col items-end gap-1 ml-4">
                            <Badge 
                              variant={match.combinedScore > 0.7 ? 'default' : match.combinedScore > 0.5 ? 'secondary' : 'outline'}
                            >
                              {formatScore(match.combinedScore)} match
                            </Badge>
                            <div className="text-xs text-muted-foreground">
                              Name: {formatScore(match.nameScore)} | Addr: {formatScore(match.addressScore)}
                            </div>
                            {isSelected && (
                              <Check className="w-5 h-5 text-primary mt-1" />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground mb-2">No matching Salesforce records found</p>
                <p className="text-sm text-muted-foreground">
                  You can enter the Year Built and Square Footage manually.
                </p>
              </div>
            )}

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={handleNoMatch}>
                None of these / Enter Manually
              </Button>
              <Button 
                onClick={handleSelectMatch} 
                disabled={selectedIndex === null}
              >
                Use Selected Match
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground">
                Enter the Year Built and Square Footage manually for this store.
              </p>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="manual-year">Year Built</Label>
                  <Input
                    id="manual-year"
                    type="number"
                    min="1900"
                    max="2030"
                    placeholder="e.g., 2015"
                    value={manualYearBuilt}
                    onChange={(e) => setManualYearBuilt(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manual-sf">Square Footage</Label>
                  <Input
                    id="manual-sf"
                    type="text"
                    placeholder="e.g., 75,000"
                    value={manualSquareFootage}
                    onChange={(e) => setManualSquareFootage(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={() => setManualMode(false)}>
                Back to Matches
              </Button>
              <Button onClick={handleManualSubmit}>
                Save Manual Entry
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
