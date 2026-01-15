import { BarChart3, Building2 } from "lucide-react";
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

export default function RCAPage() {
  const { state, actions } = useRCAWizard();

  const renderStep = () => {
    switch (state.currentStep) {
      case 1:
        return (
          <StepSearch
            criteria={state.searchCriteria}
            onUpdate={actions.updateSearchCriteria}
            onSearch={async () => {
              await actions.searchStores();
              actions.nextStep();
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
            onNext={actions.nextStep}
            isLoading={state.isLoading}
          />
        );
      case 3:
        return (
          <StepCompetitors
            subjectStore={state.subjectStore!}
            competitors={state.competitors}
            onSelect={actions.selectStoresForAnalysis}
            onNext={actions.nextStep}
            onBack={actions.prevStep}
            isLoading={state.isLoading}
          />
        );
      case 4:
        return (
          <StepMetadata
            stores={state.selectedStores}
            metadata={state.storeMetadata}
            onUpdate={actions.updateStoreMetadata}
            onNext={actions.nextStep}
            onBack={actions.prevStep}
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
            onNext={actions.nextStep}
            onBack={actions.prevStep}
          />
        );
      case 6:
        return (
          <StepAdjustments
            factors={state.adjustmentFactors}
            onUpdate={actions.updateAdjustmentFactors}
            onNext={actions.nextStep}
            onBack={actions.prevStep}
          />
        );
      case 7:
        return (
          <StepNames
            stores={state.selectedStores}
            customNames={state.customNames}
            onUpdate={actions.updateCustomName}
            onNext={actions.nextStep}
            onBack={actions.prevStep}
          />
        );
      case 8:
        return (
          <StepDataGaps
            gaps={state.dateGaps}
            selectedApiStores={state.apiStoreIds}
            onSetApiStores={actions.setApiStoreIds}
            onAnalyze={actions.analyzeGaps}
            isLoading={state.isLoading}
            onNext={actions.nextStep}
            onBack={actions.prevStep}
          />
        );
      case 9:
        return (
          <StepFeatureCodes
            featureCodes={state.featureCodes}
            onUpdate={actions.updateFeatureCode}
            onInitialize={actions.initializeFeatureCodes}
            onNext={actions.nextStep}
            onBack={actions.prevStep}
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
            onBack={actions.prevStep}
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
        </div>
      </header>

      {/* Progress Bar */}
      <div className="border-b bg-card/50">
        <div className="container mx-auto overflow-x-auto">
          <WizardProgress
            steps={WIZARD_STEPS}
            currentStep={state.currentStep}
            onStepClick={actions.setStep}
          />
        </div>
      </div>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 pb-24">{renderStep()}</main>
    </div>
  );
}
