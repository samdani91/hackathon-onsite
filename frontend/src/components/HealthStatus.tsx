import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Clock, Server } from 'lucide-react';
import { apiService, HealthStatus as HealthStatusType } from '../services/api';
import { captureError } from '../telemetry/sentry';

export const HealthStatus: React.FC = () => {
  const [health, setHealth] = useState<HealthStatusType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date>(new Date());

  const fetchHealth = async () => {
    try {
      setLoading(true);
      setError(null);
      const healthData = await apiService.getHealth();
      setHealth(healthData);
      setLastChecked(new Date());
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch health status';
      setError(errorMessage);
      captureError(new Error(errorMessage), { component: 'HealthStatus' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours}h ${minutes}m ${secs}s`;
  };

  const isHealthy = health?.status === 'ok';

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900">API Health Status</h2>
        <button
          onClick={fetchHealth}
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Checking...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-red-500" />
            <span className="text-red-800 font-medium">Connection Error</span>
          </div>
          <p className="text-red-700 mt-1">{error}</p>
        </div>
      )}

      {health && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Status Card */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Status</p>
                <p className={`text-2xl font-bold ${isHealthy ? 'text-green-600' : 'text-red-600'}`}>
                  {health.status.toUpperCase()}
                </p>
              </div>
              {isHealthy ? (
                <CheckCircle className="h-8 w-8 text-green-500" />
              ) : (
                <XCircle className="h-8 w-8 text-red-500" />
              )}
            </div>
          </div>

          {/* Uptime Card */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Uptime</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatUptime(health.uptime)}
                </p>
              </div>
              <Clock className="h-8 w-8 text-blue-500" />
            </div>
          </div>

          {/* Version Card */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Version</p>
                <p className="text-2xl font-bold text-gray-900">{health.version}</p>
              </div>
              <Server className="h-8 w-8 text-purple-500" />
            </div>
          </div>

          {/* Last Checked Card */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Last Checked</p>
                <p className="text-lg font-bold text-gray-900">
                  {lastChecked.toLocaleTimeString()}
                </p>
              </div>
              <div className={`h-3 w-3 rounded-full ${isHealthy ? 'bg-green-500' : 'bg-red-500'}`} />
            </div>
          </div>
        </div>
      )}

      {/* Detailed Information */}
      {health && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">System Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <dt className="text-sm font-medium text-gray-500">Timestamp</dt>
              <dd className="text-sm text-gray-900">{new Date(health.timestamp).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Environment</dt>
              <dd className="text-sm text-gray-900">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  Development
                </span>
              </dd>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};