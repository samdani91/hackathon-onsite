import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Clock, TrendingUp, Activity, Zap } from 'lucide-react';

interface PerformanceData {
  timestamp: string;
  responseTime: number;
  successRate: number;
  errorRate: number;
  throughput: number;
}

export const PerformanceMetrics: React.FC = () => {
  const [performanceData, setPerformanceData] = useState<PerformanceData[]>([]);
  const [timeRange, setTimeRange] = useState<'1h' | '6h' | '24h'>('1h');

  // Generate mock performance data
  useEffect(() => {
    const generateData = () => {
      const now = new Date();
      const data: PerformanceData[] = [];
      
      for (let i = 23; i >= 0; i--) {
        const timestamp = new Date(now.getTime() - i * 5 * 60 * 1000); // 5-minute intervals
        data.push({
          timestamp: timestamp.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit' 
          }),
          responseTime: Math.random() * 2000 + 200, // 200-2200ms
          successRate: Math.random() * 10 + 90, // 90-100%
          errorRate: Math.random() * 5, // 0-5%
          throughput: Math.random() * 50 + 10, // 10-60 requests/min
        });
      }
      
      return data;
    };

    setPerformanceData(generateData());
    
    // Update data every 30 seconds
    const interval = setInterval(() => {
      setPerformanceData(generateData());
    }, 30000);

    return () => clearInterval(interval);
  }, [timeRange]);

  const averageResponseTime = performanceData.reduce((sum, d) => sum + d.responseTime, 0) / performanceData.length;
  const averageSuccessRate = performanceData.reduce((sum, d) => sum + d.successRate, 0) / performanceData.length;
  const totalThroughput = performanceData.reduce((sum, d) => sum + d.throughput, 0);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900">Performance Metrics</h2>
        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value as any)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="1h">Last Hour</option>
          <option value="6h">Last 6 Hours</option>
          <option value="24h">Last 24 Hours</option>
        </select>
      </div>

      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Avg Response Time</p>
              <p className="text-2xl font-bold text-blue-600">
                {averageResponseTime.toFixed(0)}ms
              </p>
            </div>
            <Clock className="h-8 w-8 text-blue-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Success Rate</p>
              <p className="text-2xl font-bold text-green-600">
                {averageSuccessRate.toFixed(1)}%
              </p>
            </div>
            <TrendingUp className="h-8 w-8 text-green-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Requests</p>
              <p className="text-2xl font-bold text-purple-600">
                {totalThroughput.toFixed(0)}
              </p>
            </div>
            <Activity className="h-8 w-8 text-purple-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">P95 Latency</p>
              <p className="text-2xl font-bold text-orange-600">
                {(averageResponseTime * 1.5).toFixed(0)}ms
              </p>
            </div>
            <Zap className="h-8 w-8 text-orange-500" />
          </div>
        </div>
      </div>

      {/* Response Time Chart */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Response Time Trends</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={performanceData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="timestamp" />
              <YAxis />
              <Tooltip 
                formatter={(value: number) => [`${value.toFixed(0)}ms`, 'Response Time']}
              />
              <Line 
                type="monotone" 
                dataKey="responseTime" 
                stroke="#3B82F6" 
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Success Rate and Throughput */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Success Rate</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={performanceData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" />
                <YAxis domain={[85, 100]} />
                <Tooltip 
                  formatter={(value: number) => [`${value.toFixed(1)}%`, 'Success Rate']}
                />
                <Line 
                  type="monotone" 
                  dataKey="successRate" 
                  stroke="#10B981" 
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Request Throughput</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={performanceData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" />
                <YAxis />
                <Tooltip 
                  formatter={(value: number) => [`${value.toFixed(0)}`, 'Requests/min']}
                />
                <Bar dataKey="throughput" fill="#8B5CF6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Performance Insights */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Performance Insights</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="font-medium text-gray-900 mb-2">Current Status</h4>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <div className="h-2 w-2 bg-green-500 rounded-full"></div>
                <span>API response times are within normal range</span>
              </li>
              <li className="flex items-center gap-2">
                <div className="h-2 w-2 bg-green-500 rounded-full"></div>
                <span>Success rate is above 95% threshold</span>
              </li>
              <li className="flex items-center gap-2">
                <div className="h-2 w-2 bg-yellow-500 rounded-full"></div>
                <span>Some requests experiencing higher latency</span>
              </li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-medium text-gray-900 mb-2">Recommendations</h4>
            <ul className="space-y-2 text-sm text-gray-600">
              <li>• Monitor P95 latency for performance degradation</li>
              <li>• Set up alerts for response times {'>'} 3 seconds</li>
              <li>• Consider caching for frequently accessed endpoints</li>
              <li>• Review error patterns in Sentry dashboard</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};