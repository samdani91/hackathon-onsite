import React, { useState, useEffect } from 'react';
import { Activity, Download, AlertCircle, BarChart3, ExternalLink } from 'lucide-react';
import { HealthStatus } from './HealthStatus';
import { DownloadJobs } from './DownloadJobs';
import { ErrorLog } from './ErrorLog';
import { PerformanceMetrics } from './PerformanceMetrics';
import { TraceViewer } from './TraceViewer';
import { apiService } from '../services/api';
import { getCurrentTraceId } from '../telemetry/opentelemetry';
import { captureError } from '../telemetry/sentry';

export const Dashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState('health');
  const [currentTraceId, setCurrentTraceId] = useState<string | undefined>();

  useEffect(() => {
    // Update trace ID periodically
    const interval = setInterval(() => {
      setCurrentTraceId(getCurrentTraceId());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const tabs = [
    { id: 'health', label: 'Health Status', icon: Activity },
    { id: 'downloads', label: 'Download Jobs', icon: Download },
    { id: 'errors', label: 'Error Log', icon: AlertCircle },
    { id: 'performance', label: 'Performance', icon: BarChart3 },
    { id: 'traces', label: 'Traces', icon: ExternalLink },
  ];

  const handleTestSentryError = async () => {
    try {
      await apiService.testSentryError();
    } catch (error) {
      // Error is already captured by the API interceptor
      console.log('Sentry test error triggered successfully');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Observability Dashboard
              </h1>
              <p className="text-sm text-gray-500">
                Download Service Monitoring & Tracing
              </p>
            </div>
            <div className="flex items-center space-x-4">
              {currentTraceId && (
                <div className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                  Trace: {currentTraceId.slice(0, 8)}...
                </div>
              )}
              <button
                onClick={handleTestSentryError}
                className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700"
              >
                Test Sentry
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Tab Navigation */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="space-y-6">
          {activeTab === 'health' && <HealthStatus />}
          {activeTab === 'downloads' && <DownloadJobs />}
          {activeTab === 'errors' && <ErrorLog />}
          {activeTab === 'performance' && <PerformanceMetrics />}
          {activeTab === 'traces' && <TraceViewer />}
        </div>
      </div>
    </div>
  );
};