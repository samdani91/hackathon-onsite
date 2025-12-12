import axios, { AxiosError } from 'axios';
import { captureError, addBreadcrumb } from '../telemetry/sentry';
import { createSpan, getCurrentTraceId, setSpanAttribute } from '../telemetry/opentelemetry';

const API_BASE_URL = '/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

// Add request interceptor to include trace headers
apiClient.interceptors.request.use((config) => {
  const traceId = getCurrentTraceId();
  if (traceId) {
    config.headers['x-trace-id'] = traceId;
  }
  
  addBreadcrumb(`API Request: ${config.method?.toUpperCase()} ${config.url}`, 'http', {
    url: config.url,
    method: config.method,
  });
  
  return config;
});

// Add response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => {
    addBreadcrumb(`API Response: ${response.status}`, 'http', {
      status: response.status,
      url: response.config.url,
    });
    return response;
  },
  (error: AxiosError) => {
    const errorMessage = error.response?.data || error.message;
    captureError(error, {
      url: error.config?.url,
      method: error.config?.method,
      status: error.response?.status,
    });
    
    addBreadcrumb(`API Error: ${error.response?.status || 'Network Error'}`, 'http', {
      error: errorMessage,
      url: error.config?.url,
    });
    
    return Promise.reject(error);
  }
);

export interface HealthStatus {
  status: string;
  timestamp: string;
  uptime: number;
  version: string;
}

export interface DownloadJob {
  id: string;
  file_id: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
  completed_at?: string;
  download_url?: string;
  error?: string;
}

export interface DownloadRequest {
  file_id: number;
}

export const apiService = {
  // Health check
  getHealth: (): Promise<HealthStatus> =>
    createSpan('api.getHealth', async () => {
      setSpanAttribute('api.endpoint', '/health');
      const response = await apiClient.get<HealthStatus>('/health');
      return response.data;
    }),

  // Download operations
  initiateDownload: (request: DownloadRequest): Promise<DownloadJob> =>
    createSpan('api.initiateDownload', async () => {
      setSpanAttribute('api.endpoint', '/v1/download');
      setSpanAttribute('file_id', request.file_id);
      const response = await apiClient.post<DownloadJob>('/v1/download', request);
      return response.data;
    }),

  checkDownloadStatus: (jobId: string): Promise<DownloadJob> =>
    createSpan('api.checkDownloadStatus', async () => {
      setSpanAttribute('api.endpoint', '/v1/download/check');
      setSpanAttribute('job_id', jobId);
      const response = await apiClient.post<DownloadJob>('/v1/download/check', { job_id: jobId });
      return response.data;
    }),

  // Test Sentry integration
  testSentryError: (): Promise<any> =>
    createSpan('api.testSentryError', async () => {
      setSpanAttribute('api.endpoint', '/v1/download/check');
      setSpanAttribute('sentry_test', true);
      const response = await apiClient.post('/v1/download/check?sentry_test=true', { file_id: 70000 });
      return response.data;
    }),
};