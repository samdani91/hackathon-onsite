import React, { useState, useEffect } from 'react';
import { ExternalLink, Search, Filter, Clock, Layers } from 'lucide-react';
import { getCurrentTraceId } from '../telemetry/opentelemetry';

interface TraceData {
  traceId: string;
  operationName: string;
  duration: number;
  timestamp: Date;
  status: 'success' | 'error';
  spans: number;
  service: string;
}

export const TraceViewer: React.FC = () => {
  const [traces, setTraces] = useState<TraceData[]>([]);
  const [currentTraceId, setCurrentTraceId] = useState<string | undefined>();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all');

  // Generate mock trace data
  useEffect(() => {
    const mockTraces: TraceData[] = [
      {
        traceId: '1234567890abcdef1234567890abcdef',
        operationName: 'POST /v1/download',
        duration: 1250,
        timestamp: new Date(Date.now() - 5 * 60 * 1000),
        status: 'success',
        spans: 8,
        service: 'download-api',
      },
      {
        traceId: 'fedcba0987654321fedcba0987654321',
        operationName: 'GET /health',
        duration: 45,
        timestamp: new Date(Date.now() - 10 * 60 * 1000),
        status: 'success',
        spans: 3,
        service: 'download-api',
      },
      {
        traceId: 'abcd1234efgh5678abcd1234efgh5678',
        operationName: 'POST /v1/download/check',
        duration: 3200,
        timestamp: new Date(Date.now() - 15 * 60 * 1000),
        status: 'error',
        spans: 12,
        service: 'download-api',
      },
    ];

    setTraces(mockTraces);
  }, []);

  // Update current trace ID
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTraceId(getCurrentTraceId());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const filteredTraces = traces.filter(trace => {
    const matchesSearch = trace.operationName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         trace.traceId.includes(searchTerm);
    const matchesStatus = statusFilter === 'all' || trace.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: TraceData['status']) => {
    return status === 'success' 
      ? 'bg-green-100 text-green-800' 
      : 'bg-red-100 text-red-800';
  };

  const getDurationColor = (duration: number) => {
    if (duration < 100) return 'text-green-600';
    if (duration < 1000) return 'text-yellow-600';
    return 'text-red-600';
  };

  const openInJaeger = (traceId?: string) => {
    const jaegerUrl = `http://localhost:16686/trace/${traceId || 'search'}`;
    window.open(jaegerUrl, '_blank');
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900">Distributed Traces</h2>
        <button
          onClick={() => openInJaeger()}
          className="bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 flex items-center gap-2 text-sm"
        >
          <ExternalLink className="h-4 w-4" />
          Open Jaeger UI
        </button>
      </div>

      {/* Current Trace Info */}
      {currentTraceId && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-blue-900">Current Active Trace</h3>
              <p className="text-sm text-blue-700 font-mono">{currentTraceId}</p>
            </div>
            <button
              onClick={() => openInJaeger(currentTraceId)}
              className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
            >
              View in Jaeger
            </button>
          </div>
        </div>
      )}

      {/* Search and Filters */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by operation name or trace ID..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All Status</option>
              <option value="success">Success Only</option>
              <option value="error">Errors Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Trace Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Traces</p>
              <p className="text-2xl font-bold text-gray-900">{traces.length}</p>
            </div>
            <Layers className="h-8 w-8 text-blue-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Success Rate</p>
              <p className="text-2xl font-bold text-green-600">
                {((traces.filter(t => t.status === 'success').length / traces.length) * 100).toFixed(1)}%
              </p>
            </div>
            <div className="h-8 w-8 bg-green-100 rounded-full flex items-center justify-center">
              <div className="h-4 w-4 bg-green-500 rounded-full"></div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Avg Duration</p>
              <p className="text-2xl font-bold text-blue-600">
                {(traces.reduce((sum, t) => sum + t.duration, 0) / traces.length).toFixed(0)}ms
              </p>
            </div>
            <Clock className="h-8 w-8 text-blue-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Error Rate</p>
              <p className="text-2xl font-bold text-red-600">
                {((traces.filter(t => t.status === 'error').length / traces.length) * 100).toFixed(1)}%
              </p>
            </div>
            <div className="h-8 w-8 bg-red-100 rounded-full flex items-center justify-center">
              <div className="h-4 w-4 bg-red-500 rounded-full"></div>
            </div>
          </div>
        </div>
      </div>

      {/* Traces List */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">Recent Traces</h3>
        </div>

        {filteredTraces.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Layers className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>No traces found matching your criteria.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredTraces.map((trace) => (
              <div key={trace.traceId} className="p-6 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(trace.status)}`}>
                        {trace.status.toUpperCase()}
                      </span>
                      <h4 className="font-medium text-gray-900">{trace.operationName}</h4>
                    </div>
                    
                    <p className="text-sm text-gray-500 font-mono mb-2">
                      {trace.traceId}
                    </p>
                    
                    <div className="flex items-center gap-6 text-sm text-gray-600">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <span className={getDurationColor(trace.duration)}>
                          {trace.duration}ms
                        </span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Layers className="h-3 w-3" />
                        {trace.spans} spans
                      </span>
                      <span>{trace.timestamp.toLocaleString()}</span>
                    </div>
                  </div>
                  
                  <button
                    onClick={() => openInJaeger(trace.traceId)}
                    className="bg-orange-600 text-white px-3 py-1 rounded text-sm hover:bg-orange-700 flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Integration Info */}
      <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <ExternalLink className="h-5 w-5 text-orange-600" />
          <span className="font-medium text-orange-900">OpenTelemetry Integration</span>
        </div>
        <p className="text-orange-800 text-sm">
          Traces are automatically collected and exported to Jaeger for visualization. 
          Each user interaction creates spans that are correlated with backend operations, 
          providing end-to-end visibility into request flows.
        </p>
      </div>
    </div>
  );
};