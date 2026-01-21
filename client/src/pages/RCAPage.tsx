import { useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { BarChart3, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRCAWizard, WIZARD_STEPS } from "@/hooks/useRCAWizard";
import { WizardProgress } from "@/components/rca/WizardProgress";
import { StepSearch } from "@/components/rca/StepSearch";
import { StepSubjectStore } from "@/components/rca/StepSubjectStore";
import { StepCompetitors } from "@/components/rca/StepCompetitors";
import { StepMetadata } from "@/components/rca/StepMetadata";
import { StepRankings } from "@/components/rca/StepRankings";
import { StepAdjustments } from "@/components/rca/StepAdjustments";
import { StepNames } from "@/components/rca/StepNames";
import { StepDataGaps } from "@/components/rca/StepDataGaps";
import { StepFeatureCodes } from "@/components/rca/StepFeatureCodes";
import { StepDataVisualization } from "@/components/rca/StepDataVisualization";

// Map URL slugs to step numbers
const STEP_ROUTES: Record<string, number> = {
  'search': 1,
  'subject-store': 2,
  'competitors': 3,
  'metadata': 4,
  'rankings': 5,
  'adjustments': 6,
  'names': 7,
  'data-gaps': 8,
  'feature-codes': 9,
  'data-visualization': 10,
};

// Reverse mapping: step numbers to URL slugs
const STEP_SLUGS: Record<number, string> = Object.fromEntries(
  Object.entries(STEP_ROUTES).map(([slug, num]) => [num, slug])
);

export default function RCAPage() {
  const { step: urlStep } = useParams<{ step: string }>();
  const navigate = useNavigate();
  const { state, actions } = useRCAWizard();

  // Convert URL step to number
  const urlStepNumber = urlStep ? STEP_ROUTES[urlStep] || 1 : 1;

  // Sync URL with wizard state on mount and URL changes
  useEffect(() => {
    if (urlStepNumber !== state.currentStep) {
      actions.setStep(urlStepNumber);
    }
  }, [urlStepNumber, actions.setStep]);

  // Navigate to a step via URL
  const navigateToStep = useCallback((stepNumber: number) => {
    const slug = STEP_SLUGS[stepNumber] || 'search';
    navigate(`/rca/${slug}`);
  }, [navigate]);

  // Override actions to use URL navigation
  const nextStep = useCallback(() => {
    const nextStepNum = Math.min(state.currentStep + 1, WIZARD_STEPS.length);
    navigateToStep(nextStepNum);
  }, [state.currentStep, navigateToStep]);

  const prevStep = useCallback(() => {
    const prevStepNum = Math.max(state.currentStep - 1, 1);
    navigateToStep(prevStepNum);
  }, [state.currentStep, navigateToStep]);

  const setStep = useCallback((stepNumber: number) => {
    navigateToStep(stepNumber);
  }, [navigateToStep]);

  // Start new analysis - clear state and go to search
  const startNewAnalysis = useCallback(() => {
    actions.resetWizard();
    navigate('/rca/search');
  }, [actions.resetWizard, navigate]);

  const renderStep = () => {
    switch (state.currentStep) {
      case 1:
        return (
          <StepSearch
            criteria={state.searchCriteria}
            onUpdate={actions.updateSearchCriteria}
            onSearch={async () => {
              await actions.searchStores();
              nextStep();
            }}
            isLoading={state.isLoading}
          />
        );
      case 2:
        return (
          <StepSubjectStore
            stores={state.searchResults}
            selectedStore={state.subjectStore}
            onSelect={async (store) => {
              await actions.selectSubjectStore(store);
            }}
            onNext={nextStep}
            isLoading={state.isLoading}
          />
        );
      case 3:
        return (
          <StepCompetitors
            subjectStore={state.subjectStore!}
            competitors={state.competitors}
            onSelect={actions.selectStoresForAnalysis}
            onNext={nextStep}
            onBack={prevStep}
            isLoading={state.isLoading}
          />
        );
      case 4:
        return (
          <StepMetadata
            stores={state.selectedStores}
            metadata={state.storeMetadata}
            onUpdate={actions.updateStoreMetadata}
            onNext={nextStep}
            onBack={prevStep}
            onFetchMatches={actions.fetchSalesforceMatchesForStore}
          />
        );
      case 5:
        return (
          <StepRankings
            stores={state.selectedStores}
            rankings={state.storeRankings}
            metadata={state.storeMetadata}
            onUpdate={actions.updateStoreRankings}
            onNext={nextStep}
            onBack={prevStep}
          />
        );
      case 6:
        return (
          <StepAdjustments
            factors={state.adjustmentFactors}
            onUpdate={actions.updateAdjustmentFactors}
            onNext={nextStep}
            onBack={prevStep}
          />
        );
      case 7:
        return (
          <StepNames
            stores={state.selectedStores}
            customNames={state.customNames}
            onUpdate={actions.updateCustomName}
            onNext={nextStep}
            onBack={prevStep}
          />
        );
      case 8:
        return (
          <StepDataGaps
            gaps={state.dateGaps}
            selectedApiStores={state.apiStoreIds}
            onSetApiStores={actions.setApiStoreIds}
            onAnalyze={actions.analyzeGaps}
            onFillGaps={actions.fillDataGaps}
            isLoading={state.isLoading}
            onNext={nextStep}
            onBack={prevStep}
          />
        );
      case 9:
        return (
          <StepFeatureCodes
            featureCodes={state.featureCodes}
            rateRecordCount={state.rateRecords.length}
            onUpdate={actions.updateFeatureCode}
            onInitialize={actions.initializeFeatureCodes}
            onNext={nextStep}
            onBack={prevStep}
          />
        );
      case 10:
        return (
          <StepDataVisualization
            subjectStore={state.subjectStore}
            selectedStores={state.selectedStores}
            storeMetadata={state.storeMetadata}
            storeRankings={state.storeRankings}
            adjustmentFactors={state.adjustmentFactors}
            rateRecords={state.rateRecords}
            customNames={state.customNames}
            featureCodes={state.featureCodes}
            onExport={actions.exportCSV}
            onDownloadDataDump={actions.downloadDataDump}
            onUploadEditedCSV={actions.uploadEditedCSV}
            onExcludeRecords={actions.excludeRecords}
            onApplyStoreMultiplier={actions.applyStoreRateMultiplier}
            isLoading={state.isLoading}
            onBack={prevStep}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <BarChart3 className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">
                  Rate Comparison Analysis
                </h1>
                <p className="text-sm text-muted-foreground">
                  Self-Storage Competitor Analysis Tool
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={startNewAnalysis}
              className="flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              New Analysis
            </Button>
          </div>
        </div>
      </header>

      {/* Progress Bar */}
      <div className="border-b bg-card/50">
        <div className="container mx-auto overflow-x-auto">
          <WizardProgress
            steps={WIZARD_STEPS}
            currentStep={state.currentStep}
            onStepClick={setStep}
          />
        </div>
      </div>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 pb-24">{renderStep()}</main>
    </div>
  );
}
