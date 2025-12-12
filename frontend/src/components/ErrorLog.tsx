import React, { useState, useEffect } from 'react';
import { AlertCircle, ExternalLink, RefreshCw } from 'lucide-react';
import * as Sentry from '@sentry/react';

interface ErrorEntry {
  id: string;
  message: string;
  timestamp: Date;
  level: 'error' | 'warning' | 'info';
  context?: Record<string, any>;
  traceId?: string;
}

export const ErrorLog: React.FC = () => {
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [filter, setFilter] = useState<'all' | 'error' | 'warning'>('all');

  // Simulate error log entries (in a real app, this would come from Sentry API)
  useEffect(() => {
    const mockErrors: ErrorEntry[] = [
      {
        id: '1',
        message: 'Failed to fetch download status for job abc123',
        timestamp: new Date(Date.now() - 5 * 60 * 1000),
        level: 'error',
        context: { jobId: 'abc123', endpoint: '/v1/download/check' },
        traceId: '1234567890abcdef',
      },
      {
        id: '2',
        message: 'API response time exceeded 5 seconds',
        timestamp: new Date(Date.now() - 15 * 60 * 1000),
        level: 'warning',
        context: { responseTime: 5200, endpoint: '/health' },
        traceId: 'fedcba0987654321',
      },
      {
        id: '3',
        message: 'Sentry test error triggered successfully',
        timestamp: new Date(Date.now() - 30 * 60 * 1000),
        level: 'error',
        context: { sentry_test: true, file_id: 70000 },
        traceId: 'abcd1234efgh5678',
      },
    ];

    setErrors(mockErrors);
  }, []);

  const filteredErrors = errors.filter(error => 
    filter === 'all' || error.level === filter
  );

  const getLevelColor = (level: ErrorEntry['level']) => {
    switch (level) {
      case 'error':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'warning':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default:
        return 'bg-blue-100 text-blue-800 border-blue-200';
    }
  };

  const getLevelIcon = (level: ErrorEntry['level']) => {
    return <AlertCircle className="h-4 w-4" />;
  };

  const openInSentry = () => {
    // In a real app, this would open the Sentry dashboard
    window.open('https://sentry.io', '_blank');
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900">Error Log</h2>
        <div className="flex items-center gap-4">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">All Levels</option>
            <option value="error">Errors Only</option>
            <option value="warning">Warnings Only</option>
          </select>
          <button
            onClick={openInSentry}
            className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 flex items-center gap-2 text-sm"
          >
            <ExternalLink className="h-4 w-4" />
            Open Sentry
          </button>
        </div>
      </div>

      {/* Error Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Errors</p>
              <p className="text-2xl font-bold text-red-600">
                {errors.filter(e => e.level === 'error').length}
              </p>
            </div>
            <AlertCircle className="h-8 w-8 text-red-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Warnings</p>
              <p className="text-2xl font-bold text-yellow-600">
                {errors.filter(e => e.level === 'warning').length}
              </p>
            </div>
            <AlertCircle className="h-8 w-8 text-yellow-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Last 24h</p>
              <p className="text-2xl font-bold text-gray-900">{errors.length}</p>
            </div>
            <RefreshCw className="h-8 w-8 text-blue-500" />
          </div>
        </div>
      </div>

      {/* Error List */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">Recent Errors & Warnings</h3>
        </div>

        {filteredErrors.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>No {filter === 'all' ? '' : filter} entries found.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredErrors.map((error) => (
              <div key={error.id} className="p-6">
                <div className="flex items-start gap-4">
                  <div className={`p-2 rounded-lg border ${getLevelColor(error.level)}`}>
                    {getLevelIcon(error.level)}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-medium text-gray-900">{error.message}</p>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getLevelColor(error.level)}`}>
                        {error.level.toUpperCase()}
                      </span>
                    </div>
                    
                    <p className="text-sm text-gray-500 mb-3">
                      {error.timestamp.toLocaleString()}
                    </p>

                    {error.traceId && (
                      <div className="mb-3">
                        <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded font-mono">
                          Trace ID: {error.traceId}
                        </span>
                      </div>
                    )}

                    {error.context && (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-gray-600 hover:text-gray-800">
                          Context Details
                        </summary>
                        <pre className="mt-2 bg-gray-50 p-3 rounded text-xs overflow-auto">
                          {JSON.stringify(error.context, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sentry Integration Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <ExternalLink className="h-5 w-5 text-blue-600" />
          <span className="font-medium text-blue-900">Sentry Integration</span>
        </div>
        <p className="text-blue-800 text-sm">
          Errors are automatically captured and sent to Sentry for detailed analysis. 
          Click "Open Sentry" to view the full dashboard with stack traces, user context, and performance data.
        </p>
      </div>
    </div>
  );
};