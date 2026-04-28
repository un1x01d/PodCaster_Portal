# Production Notes

## KPI Translation Optimization (Backlog)

KPI cards do not change frequently.  
To reduce AI translation calls/cost/latency, prefer cached/reused KPI translations and only re-translate when:

- locale changes, and
- KPI structure/signature changes (columns/card IDs/labels), or
- explicit user refresh action is requested.

Recommended implementation approach:

1. Keep a `kpi_translation_cache` keyed by:
   - `sheetStructureSignature`
   - `locale`
   - `cardId`
   - `sourceLabelHash`
2. Read cache first in UI rendering path.
3. Batch-translate only missing cache entries.
4. Persist cache in DB (`app_settings` or per-view config) with fallback to localStorage.

