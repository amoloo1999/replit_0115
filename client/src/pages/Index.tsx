import { Link } from 'react-router-dom';
import { BarChart3, ArrowRight, Building2, Database, FileSpreadsheet, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
const Index = () => {
  return <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent" />
        <div className="container mx-auto px-4 py-20 relative">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-6">
              <BarChart3 className="w-5 h-5" />
              <span className="text-sm font-medium">StorQuest Analytics</span>
            </div>
            
            <h1 className="text-4xl md:text-5xl font-bold mb-6 tracking-tight">
              Rate Comparison
              <span className="text-primary block mt-1">Analysis Tool</span>
            </h1>
            
            <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
              Comprehensive competitor analysis for self-storage facilities. 
              Search locations, compare rates, and generate detailed reports with 
              customizable adjustments.
            </p>
            
            <Link to="/rca">
              <Button size="lg" className="gap-2">
                Start Analysis
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Features Grid */}
      <div className="container mx-auto px-4 py-16">
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="border-0 shadow-card hover:shadow-elevated transition-shadow">
            <CardHeader>
              <div className="p-3 rounded-lg bg-primary/10 w-fit">
                <Building2 className="w-6 h-6 text-primary" />
              </div>
              <CardTitle className="text-lg">Store Discovery</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Search by address to find subject stores and automatically discover competitors within your radius.
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-card hover:shadow-elevated transition-shadow">
            <CardHeader>
              <div className="p-3 rounded-lg bg-primary/10 w-fit">
                <Database className="w-6 h-6 text-primary" />
              </div>
              <CardTitle className="text-lg">Data Integration</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Query local database for free rate data, with optional API fetch for missing historical records.
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-card hover:shadow-elevated transition-shadow">
            <CardHeader>
              <div className="p-3 rounded-lg bg-primary/10 w-fit">
                <TrendingUp className="w-6 h-6 text-primary" />
              </div>
              <CardTitle className="text-lg">Custom Rankings</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Rate stores on location, age, accessibility, visibility, brand, and quality with weighted adjustments.
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-card hover:shadow-elevated transition-shadow">
            <CardHeader>
              <div className="p-3 rounded-lg bg-primary/10 w-fit">
                <FileSpreadsheet className="w-6 h-6 text-primary" />
              </div>
              <CardTitle className="text-lg">CSV Export</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Generate detailed data dumps and summary reports with monthly averages and T-period calculations.
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Workflow Preview */}
      <div className="bg-muted/30 border-y">
        <div className="container mx-auto px-4 py-16">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-semibold mb-2">10-Step Analysis Workflow</h2>
            <p className="text-muted-foreground">Guided process from search to export</p>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 max-w-4xl mx-auto">
            {['Search Location', 'Select Subject', 'Pick Competitors', 'Enter Metadata', 'Rate Attributes', 'Set Adjustments', 'Customize Names', 'Review Gaps', 'Assign Codes', 'Export Reports'].map((step, index) => <div key={step} className="flex flex-col items-center text-center p-4 rounded-lg bg-card shadow-card">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                  <span className="text-sm font-semibold text-primary">{index + 1}</span>
                </div>
                <span className="text-sm font-medium">{step}</span>
              </div>)}
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-semibold mb-4">Ready to analyze your market?</h2>
          <p className="text-muted-foreground mb-6">
            Start your rate comparison analysis now and get actionable insights for your self-storage facility.
          </p>
          <Link to="/rca">
            <Button size="lg" className="gap-2">
              Launch RCA Tool
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Rate Comparison Analysis Tool • Self-Storage Industry Analytics</p>
        </div>
      </footer>
    </div>;
};
export default Index;