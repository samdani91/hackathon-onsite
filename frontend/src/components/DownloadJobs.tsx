import React, { useState, useEffect } from 'react';
import { Download, CheckCircle, XCircle, Clock, Plus, RefreshCw } from 'lucide-react';
import { apiService, DownloadJob } from '../services/api';
import { captureError, addBreadcrumb } from '../telemetry/sentry';
import { createSpan } from '../telemetry/opentelemetry';

export const DownloadJobs: React.FC = () => {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [newFileId, setNewFileId] = useState('');
  const [pollingJobs, setPollingJobs] = useState<Set<string>>(new Set());

  const initiateDownload = async () => {
    if (!newFileId.trim()) return;

    try {
      setLoading(true);
      const fileId = parseInt(newFileId);
      
      addBreadcrumb('Initiating download', 'user_action', { file_id: fileId });
      
      const job = await createSpan('download.initiate', async () => {
        return await apiService.initiateDownload({ file_id: fileId });
      });

      setJobs(prev => [job, ...prev]);
      setNewFileId('');
      
      // Start polling for this job
      startPolling(job.id);
      
    } catch (error) {
      captureError(error as Error, { 
        component: 'DownloadJobs', 
        action: 'initiate',
        file_id: newFileId 
      });
    } finally {
      setLoading(false);
    }
  };

  const checkJobStatus = async (jobId: string) => {
    try {
      const updatedJob = await apiService.checkDownloadStatus(jobId);
      
      setJobs(prev => 
        prev.map(job => job.id === jobId ? updatedJob : job)
      );

      // Stop polling if job is completed or failed
      if (updatedJob.status === 'completed' || updatedJob.status === 'failed') {
        setPollingJobs(prev => {
          const newSet = new Set(prev);
          newSet.delete(jobId);
          return newSet;
        });
      }

      return updatedJob;
    } catch (error) {
      captureError(error as Error, { 
        component: 'DownloadJobs', 
        action: 'check_status',
        job_id: jobId 
      });
    }
  };

  const startPolling = (jobId: string) => {
    setPollingJobs(prev => new Set(prev).add(jobId));
  };

  useEffect(() => {
    if (pollingJobs.size === 0) return;

    const interval = setInterval(() => {
      pollingJobs.forEach(jobId => {
        checkJobStatus(jobId);
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [pollingJobs]);

  const getStatusIcon = (status: DownloadJob['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'processing':
        return <RefreshCw className="h-5 w-5 text-blue-500 animate-spin" />;
      default:
        return <Clock className="h-5 w-5 text-yellow-500" />;
    }
  };

  const getStatusColor = (status: DownloadJob['status']) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'processing':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-yellow-100 text-yellow-800';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900">Download Jobs</h2>
      </div>

      {/* New Download Form */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Initiate New Download</h3>
        <div className="flex gap-4">
          <input
            type="number"
            value={newFileId}
            onChange={(e) => setNewFileId(e.target.value)}
            placeholder="Enter File ID"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={initiateDownload}
            disabled={loading || !newFileId.trim()}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            {loading ? 'Starting...' : 'Start Download'}
          </button>
        </div>
      </div>

      {/* Jobs List */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">Recent Jobs</h3>
        </div>
        
        {jobs.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Download className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>No download jobs yet. Start your first download above.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {jobs.map((job) => (
              <div key={job.id} className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {getStatusIcon(job.status)}
                    <div>
                      <p className="font-medium text-gray-900">File ID: {job.file_id}</p>
                      <p className="text-sm text-gray-500">Job ID: {job.id}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(job.status)}`}>
                      {job.status.toUpperCase()}
                    </span>
                    
                    {job.status === 'processing' && (
                      <button
                        onClick={() => checkJobStatus(job.id)}
                        className="text-blue-600 hover:text-blue-800 text-sm"
                      >
                        Check Status
                      </button>
                    )}
                    
                    {job.download_url && (
                      <a
                        href={job.download_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700"
                      >
                        Download
                      </a>
                    )}
                  </div>
                </div>
                
                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <dt className="font-medium text-gray-500">Created</dt>
                    <dd className="text-gray-900">{new Date(job.created_at).toLocaleString()}</dd>
                  </div>
                  
                  {job.completed_at && (
                    <div>
                      <dt className="font-medium text-gray-500">Completed</dt>
                      <dd className="text-gray-900">{new Date(job.completed_at).toLocaleString()}</dd>
                    </div>
                  )}
                  
                  {job.error && (
                    <div className="col-span-2">
                      <dt className="font-medium text-gray-500">Error</dt>
                      <dd className="text-red-600">{job.error}</dd>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};