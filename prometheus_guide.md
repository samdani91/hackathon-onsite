## 1. Metrics Strategy

### 1.1 Core Metrics to Collect

#### Request-Level Metrics
- **Request throughput**: Total requests per endpoint
- **Request duration**: End-to-end latency distribution
- **Error rates**: Failed requests by type and endpoint
- **Active requests**: In-flight request count (gauge)

#### Download-Specific Metrics
- **Download initiation rate**: Jobs created per second
- **Download processing time**: Actual processing duration distribution
- **Simulated delay distribution**: Track the random delay applied
- **File availability rate**: S3 check success/failure ratio
- **Download success/failure ratio**: Completed vs failed downloads
- **File size distribution**: Bytes transferred per download

#### System Health Metrics
- **S3 operation latency**: HeadObject call durations
- **S3 operation errors**: By error type (NotFound, AccessDenied, timeout)
- **Rate limiter state**: Requests rejected, remaining quota
- **Timeout occurrences**: Requests exceeding REQUEST_TIMEOUT_MS

#### Resource Metrics
- **Concurrent downloads**: Active /v1/download/start requests
- **Queue depth**: Pending download jobs (if implemented)
- **Memory pressure indicators**: Via default prom-client collectors

### 1.2 Prometheus Metric Types & Rationale

#### Counters
**Use for**: Monotonically increasing values that reset on restart
```
http_requests_total{method, path, status}
download_requests_total{endpoint, status, file_available}
s3_operations_total{operation, result}
rate_limit_rejections_total
timeout_errors_total{endpoint}
```
**Why**: Calculate rates, identify trends, compute error ratios

#### Gauges
**Use for**: Point-in-time measurements that can increase/decrease
```
http_requests_in_flight{method, path}
download_active_count
download_queue_depth
rate_limit_remaining_quota{client_id}
```
**Why**: Understand current load, detect saturation, identify bottlenecks

#### Histograms
**Use for**: Latency and size distributions with pre-defined buckets
```
http_request_duration_seconds{method, path, status}
download_processing_duration_seconds{file_available}
download_simulated_delay_seconds
download_file_size_bytes{status}
s3_operation_duration_seconds{operation}
```
**Why**: Calculate percentiles (p50, p95, p99), SLOs, and detect long-tail latency. Efficient for Prometheus aggregation across instances.

**Critical**: Use histograms over summaries in production for aggregatability.

#### Summaries (Use Sparingly)
**Consider for**: Pre-calculated percentiles when cross-instance aggregation isn't needed
```
download_duration_summary{quantile}  // Only if histogram buckets insufficient
```
**Why**: Lower memory overhead, but cannot aggregate across replicas.

**Recommendation**: Prefer histograms unless memory is severely constrained.

### 1.3 Labeling Strategy

#### Safe Labels (Low Cardinality)
```
method: GET, POST, OPTIONS
path: /, /health, /v1/download/initiate, /v1/download/check, /v1/download/start
status: 200, 400, 404, 500, 503, timeout
endpoint: initiate, check, start
file_available: true, false
operation: HeadObject, GetObject
result: success, not_found, access_denied, timeout, error
environment: development, production, test
```

#### Conditional Labels (Medium Cardinality - Use with Caution)
```
file_size_bucket: <1MB, 1-10MB, 10-100MB, >100MB  // Bucketed, not exact
delay_bucket: <30s, 30-60s, 60-120s, >120s  // Track delay ranges
client_type: api, web, mobile  // If identifiable from headers
```

#### Avoid High-Cardinality Labels
**Never use**:
- Individual file_id (millions of unique values)
- request_id / jobId (UUIDs)
- Full S3 keys
- IP addresses (use aggregated client_type instead)
- Exact file sizes or timestamps

**Mitigation**: Use buckets/ranges instead of exact values. Store high-cardinality data in traces/logs, correlate via shared identifiers.

---

## 2. Latency & Variability Analysis

### 2.1 Modeling Variable Processing Times

#### Histogram Bucket Strategy for Download Duration

Given delays range from 10-200 seconds, use **logarithmic-style buckets** to capture distribution:

```
download_processing_duration_seconds buckets:
[0.1, 0.5, 1, 2, 5, 10, 15, 30, 45, 60, 90, 120, 150, 180, 210, 240, 300, +Inf]
```

**Rationale**:
- Fine-grained at low latencies (0.1-10s) to catch fast-path optimizations
- Coarser at high latencies (60-300s) where variability is expected
- Captures the full range of simulated delays (10-200s)
- Enables p95, p99, p99.9 calculation

#### Histogram Bucket Strategy for HTTP Request Duration

```
http_request_duration_seconds buckets:
[0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60, 120, 180, 240, 300, +Inf]
```

**Rationale**:
- Sub-second buckets for fast endpoints (/health, /v1/download/check)
- Extended range for long-running /v1/download/start
- Aligns with timeout configuration (30s default)

#### File Size Buckets

```
download_file_size_bytes buckets:
[1000, 10000, 100000, 1000000, 10000000, 100000000, 1000000000, +Inf]
```
(1KB, 10KB, 100KB, 1MB, 10MB, 100MB, 1GB, +Inf)

### 2.2 Detecting Anomalies

#### Long-Tail Latency Detection
**Alert on**: `histogram_quantile(0.99, rate(download_processing_duration_seconds_bucket[5m])) > 180`
- Indicates p99 latency exceeding expected max (200s means something's wrong)

#### Slow Download Detection
**Query**: Ratio of downloads exceeding 120s
```
sum(rate(download_processing_duration_seconds_bucket{le="120"}[5m])) 
/ 
sum(rate(download_processing_duration_seconds_count[5m]))
```
**Alert if** < 0.7 (more than 30% of downloads are slow)

#### Stalled Request Detection
**Method 1**: Track requests exceeding timeout
```
increase(timeout_errors_total{endpoint="start"}[5m]) > 5
```

**Method 2**: Compare in-flight gauge over time
```
download_active_count > 100 for 10m  // Abnormally high active requests
```

**Method 3**: Monitor bucket distribution shift
```
rate(download_processing_duration_seconds_bucket{le="240"}[5m]) 
- 
rate(download_processing_duration_seconds_bucket{le="180"}[5m])
```
Spike indicates requests clustering at upper bound

---

## 3. Error & Reliability Signals

### 3.1 Error Classification Metrics

#### Client Errors (4xx)
```
http_requests_total{status="400"}  // Invalid input
http_requests_total{status="404"}  // Not found
rate_limit_rejections_total        // Rate limit exceeded
```
**Purpose**: Identify API misuse, client integration issues

#### System Errors (5xx)
```
http_requests_total{status="500"}  // Internal errors
http_requests_total{status="503"}  // S3 unhealthy
s3_operations_total{result="error"}
s3_operations_total{result="timeout"}
```
**Purpose**: Detect infrastructure failures, downstream dependency issues

#### Partial Failures
```
download_requests_total{endpoint="start", status="failed", file_available="false"}
```
**Purpose**: Track downloads that completed processing but file wasn't available

### 3.2 Retry & Timeout Signals

#### Timeout Tracking
```
timeout_errors_total{endpoint}  // Requests exceeding REQUEST_TIMEOUT_MS
```
**Alert**: `rate(timeout_errors_total[5m]) > 0.05` (>5% timeout rate)

#### S3 Dependency Health
```
s3_operations_total{operation="HeadObject", result="success"}
s3_operations_total{operation="HeadObject", result="access_denied"}
s3_operations_total{operation="HeadObject", result="timeout"}
```

**Health indicator**:
```
sum(rate(s3_operations_total{result!="success"}[5m])) 
/ 
sum(rate(s3_operations_total[5m]))
```
**Alert if** > 0.1 (10% S3 error rate)

#### Retry Behavior (If Implemented)
```
download_retries_total{endpoint, reason}  // reason: timeout, s3_error, network
download_retry_exhausted_total{endpoint}
```

### 3.3 Distinguishing Failure Types

#### Error Rate by Category
```
# Client errors (should be low, steady)
sum(rate(http_requests_total{status=~"4.."}[5m])) by (path)

# System errors (should be near zero)
sum(rate(http_requests_total{status=~"5.."}[5m])) by (path)

# Downstream errors
sum(rate(s3_operations_total{result!="success"}[5m])) by (result)
```

#### Cascade Failure Detection
**Alert**: Simultaneous spikes in system errors + S3 errors + active request count
```
(rate(http_requests_total{status="503"}[1m]) > 1) 
AND 
(rate(s3_operations_total{result="error"}[1m]) > 5)
AND
(download_active_count > 50)
```

---

## 4. Resource & Capacity Visibility

### 4.1 Concurrency Metrics

#### Active Request Tracking
```
http_requests_in_flight{path="/v1/download/start"}  // Gauge
download_active_count  // Gauge, specific to downloads
```

**Saturation indicator**:
```
download_active_count / max_concurrent_downloads_configured
```
**Alert if** > 0.8 (80% capacity)

#### Queue Depth (Future)
If implementing job queue:
```
download_queue_depth{priority}  // Gauge
download_queue_wait_duration_seconds  // Histogram
```

### 4.2 Rate Limiting Visibility

```
rate_limit_rejections_total{client_id}  // Counter
rate_limit_remaining_quota{client_id}   // Gauge
```

**Client degradation detection**:
```
rate(rate_limit_rejections_total[5m]) > 10
```

### 4.3 Backpressure Indicators

#### Request Rejection Rate
```
sum(rate(rate_limit_rejections_total[5m])) 
/ 
sum(rate(http_requests_total[5m]))
```
**Alert if** > 0.2 (20% rejection rate)

#### Timeout Saturation
```
increase(timeout_errors_total[5m]) > increase(http_requests_total{status="200"}[5m])
```
More timeouts than successes = severe overload

#### Memory/CPU Pressure
Use default `prom-client` collectors:
```
process_resident_memory_bytes
process_cpu_seconds_total
nodejs_eventloop_lag_seconds
nodejs_heap_size_used_bytes / nodejs_heap_size_total_bytes
```

**Alert**: Event loop lag > 1s indicates Node.js saturation

---

## 5. Tracing & Correlation (Conceptual)

### 5.1 Correlation Identifiers

#### Expose in Metrics (as exemplars, not labels)
- **request_id**: Added by middleware, returned in headers
- **jobId**: Returned by /v1/download/initiate
- **trace_id**: From OpenTelemetry span context

**Implementation approach**:
- Store correlation IDs in metric **exemplars** (not labels)
- Enable exemplar support in prom-client histograms
- Configure Prometheus to scrape exemplars

Example:
```
download_processing_duration_seconds_bucket{le="30"} 42 # {trace_id="abc123",request_id="xyz789"} 28.5 @timestamp
```

### 5.2 Cross-Tool Debugging Strategy

#### Metrics → Traces
1. **Identify slow endpoint in Grafana**: p99 latency spike on /v1/download/start
2. **Query exemplars**: Get trace_id from slow request bucket
3. **Jump to trace in Jaeger/Tempo**: View detailed span breakdown

#### Metrics → Logs
1. **Detect error spike**: S3 errors increase
2. **Filter logs by timeframe + file_id range**: Correlate via structured logging
3. **Analyze error patterns**: Group by error message

### 5.3 Contextual Fields for Debugging

#### Include in structured logs (not metrics):
- `file_id`: Specific file being processed
- `request_id`: Unique request identifier
- `jobId`: Batch job identifier
- `s3Key`: Full S3 object path
- `clientIp`: Source IP (hashed/anonymized)
- `delayMs`: Actual simulated delay applied
- `availabilityCheckDuration`: S3 HeadObject latency

#### Metric-to-Log Correlation Pattern
```
1. Alert fires: p99 > 180s
2. Query metrics: Which file_size_bucket is affected?
3. Query logs: Filter by timestamp + file_size_range
4. Identify: Specific file_ids or S3 keys causing slowness
```

---

## 6. Operational Readiness

### 6.1 SLI/SLO Framework

#### Suggested SLIs (Service Level Indicators)

**Availability SLI**:
```
sum(rate(http_requests_total{status!~"5.."}[5m])) 
/ 
sum(rate(http_requests_total[5m]))
```
**Target SLO**: 99.9% (non-5xx responses)

**Latency SLI** (Fast Endpoints):
```
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{path=~"/health|/v1/download/check"}[5m]))
```
**Target SLO**: p95 < 1s

**Latency SLI** (Download Endpoint):
```
histogram_quantile(0.95, rate(download_processing_duration_seconds_bucket[5m]))
```
**Target SLO**: p95 < 150s (accounting for max expected delay)

**Success Rate SLI**:
```
sum(rate(download_requests_total{endpoint="start", status="completed"}[5m])) 
/ 
sum(rate(download_requests_total{endpoint="start"}[5m]))
```
**Target SLO**: 95% (completed downloads)

### 6.2 Alert Conditions (Conceptual)

#### Critical Alerts

**Service Down**:
```
up{job="file-download-service"} == 0
```

**High Error Rate**:
```
(sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))) > 0.05
FOR 5m
```
Severity: Page

**SLO Breach - Availability**:
```
(sum(rate(http_requests_total{status!~"5.."}[1h])) / sum(rate(http_requests_total[1h]))) < 0.999
```
Severity: Page

**S3 Dependency Failure**:
```
sum(rate(s3_operations_total{result="error"}[5m])) > 10
FOR 10m
```
Severity: Page

#### Warning Alerts

**Elevated Latency**:
```
histogram_quantile(0.95, rate(download_processing_duration_seconds_bucket[10m])) > 180
FOR 15m
```
Severity: Ticket

**High Timeout Rate**:
```
rate(timeout_errors_total[5m]) / rate(http_requests_total[5m]) > 0.1
FOR 10m
```
Severity: Ticket

**Approaching Capacity**:
```
download_active_count > 80
FOR 5m
```
Severity: Ticket

**Rate Limit Saturation**:
```
rate(rate_limit_rejections_total[5m]) > 50
```
Severity: Ticket

### 6.3 Metric Naming Conventions

#### Follow Prometheus Best Practices

**Format**: `<namespace>_<subsystem>_<name>_<unit>`

Examples:
```
# Counters (use _total suffix)
http_requests_total
download_requests_total
s3_operations_total

# Gauges (no suffix)
http_requests_in_flight
download_active_count
download_queue_depth

# Histograms (use _seconds or _bytes suffix)
http_request_duration_seconds
download_processing_duration_seconds
download_file_size_bytes

# Base units
- Durations: seconds (not milliseconds)
- Sizes: bytes (not KB/MB)
- Rates: per second (computed via rate())
```

#### Namespace Strategy
```
http_*           // HTTP layer metrics
download_*       // Business logic metrics
s3_*             // S3 dependency metrics
rate_limit_*     // Rate limiting metrics
```

### 6.4 Documentation Requirements

#### Metric Catalog
Maintain a **metrics.md** document with:
1. **Metric name**
2. **Type** (counter, gauge, histogram)
3. **Description**: What it measures
4. **Labels**: Dimension breakdown
5. **Unit**: seconds, bytes, count
6. **Cardinality estimate**: Labels × label values
7. **Use cases**: What questions it answers
8. **Related metrics**: For correlation

#### Example Entry
```markdown
### download_processing_duration_seconds
- **Type**: Histogram
- **Description**: Total time spent processing a download request, including simulated delay and S3 checks
- **Labels**: `file_available` (true/false)
- **Unit**: seconds
- **Buckets**: [0.1, 0.5, 1, 2, 5, 10, 15, 30, 45, 60, 90, 120, 150, 180, 210, 240, 300, +Inf]
- **Cardinality**: 2 (file_available values)
- **Use cases**:
  - Calculate p50, p95, p99 download latency
  - Detect long-tail latency issues
  - Compare latency for available vs unavailable files
  - SLO monitoring (p95 < 150s)
- **Related metrics**: `download_requests_total`, `download_simulated_delay_seconds`
```

---

## 7. Implementation Roadmap (High-Level)

### Phase 1: Core Request Metrics (Week 1)
- HTTP request counter (path, method, status)
- HTTP request duration histogram
- HTTP requests in-flight gauge
- Default Node.js metrics (memory, CPU, event loop)

### Phase 2: Business Logic Metrics (Week 2)
- Download-specific counters (initiate, check, start)
- Download processing duration histogram
- Download active count gauge
- File availability tracking

### Phase 3: Dependency & Error Metrics (Week 3)
- S3 operation metrics (latency, errors)
- Timeout tracking
- Rate limit metrics
- Error classification

### Phase 4: Advanced Observability (Week 4)
- Exemplar support for trace correlation
- File size distribution histogram
- Simulated delay tracking
- Queue depth metrics (if applicable)

### Phase 5: Alerting & Dashboards (Week 5)
- Configure SLO-based alerts
- Build Grafana dashboards
- Document runbooks
- Load testing & validation

---

## 8. Key Takeaways

### Critical Success Factors
1. **Histograms over summaries** for aggregatable latency metrics
2. **Bucket design** must capture full range of variability (10-200s)
3. **Label cardinality control** to prevent metric explosion
4. **Exemplar support** for metrics-to-traces correlation
5. **Layered monitoring**: Request → Business Logic → Dependencies

