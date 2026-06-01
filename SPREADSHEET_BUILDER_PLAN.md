# Spreadsheet Builder Implementation Plan
## 1. Vision & Feature Description
The Spreadsheet Builder is a powerful no-code data-standardization tool designed to bridge the gap between "messy" real-world data uploads and the strict schema requirements of AI analysis and financial modeling.

When users upload spreadsheets that don't match the application's expected format (e.g., missing specific columns like "Net Revenue", or having data spread across multiple columns), the AI and Insight engines often fail or hallucinate. The Spreadsheet Builder solves this by allowing users to interactively transform their incompatible uploads into a "Canonical Version" that the platform can process with 100% accuracy.

Instead of forcing users to manually edit Excel files externally, the Spreadsheet Builder provides a virtual ETL (Extract, Transform, Load) interface:
- **Source**: The raw, uploaded spreadsheet (handling large files gracefully).
- **Template**: An Admin-defined "Ideal Schema" (e.g., "Standard P&L" or "SaaS Metrics").
- **Transformation**: A JSON-defined mapping created interactively by the user.
- **Target**: A new, generated spreadsheet record physically optimized for the platform.

The UX centers on a split-pane drag-and-drop interface where users can quickly sample their raw data (first ~50 rows) and map it to the template requirements. It supports complex operations like 1-to-1 mappings, column merging/math, default value assignments, and row filtering, all while providing a real-time live preview of the resulting standardized data.

## 2. Objective
Implement this interactive, drag-and-drop tool to map incompatible, raw spreadsheet uploads to standardized, admin-defined templates. The output will be a fully compatible spreadsheet optimized for AI processing and deterministic calculations.

## 3. Scope & Impact
- **Database**: Introduce new schema for `sheet_templates` (admin-defined required schemas) and `sheet_build_configs` (saved mappings).
- **Backend API**: New endpoints to fetch templates, save builder configurations, and execute the ETL mapping job.
- **Frontend UI**: A new side-by-side interactive React view. The left pane shows the raw uploaded data; the right pane shows the target template schema. Users can drag-and-drop columns from left to right, apply math/merging, set default values, and define row filters.
- **Data Flow**: The builder acts as an ETL pipeline. It reads the raw `sheet_rows`, applies the JSON-defined transformation mapping, and inserts a new, compliant `sheets` record that the rest of the application (AI, Insights) can use natively.

## 4. Implementation Steps

### Phase 1: Data Model (Database Migrations)
Create `db/init/014_sheet_builder.sql`:
1.  **`sheet_templates` table**:
    *   `id` (PK)
    *   `name` (e.g., "Standard Income Statement")
    *   `description`
    *   `schema_definition` (JSONB) - Defines required columns, expected data types (currency, date, text), and optional columns.
    *   `created_by` (FK to users)
2.  **`sheet_build_configs` table**:
    *   `id` (PK)
    *   `source_sheet_id` (FK to sheets)
    *   `template_id` (FK to sheet_templates)
    *   `mapping_rules` (JSONB) - Stores the UI configuration (1-to-1 mappings, formulas, defaults, filters).

### Phase 2: Backend API
Create `backend/src/controllers/sheetBuilderController.js`:
1.  **Template Management**: `GET /api/sheet-templates` (and CRUD for Admins).
2.  **Preview Mapping**: `POST /api/sheets/:id/builder/preview` - Accepts a draft `mapping_rules` JSON and applies it ONLY to a subset (e.g., first 50 rows) of the source data. Returns this fast preview so the user can verify their drag-and-drop math/filters in real-time without processing the entire 10,000+ row dataset synchronously.
3.  **Execute Build**: `POST /api/sheets/:id/builder/execute` - Queues the ETL process as a background worker job (similar to existing import jobs) to prevent API timeouts on large files:
    *   Loads source rows in chunks/streams.
    *   Applies filters (e.g., "Exclude rows where Revenue is empty").
    *   Applies column mappings (e.g., `Template.Date = Source.Month`, `Template.Revenue = Source.Q1 + Source.Q2`).
    *   Fills default values.
    *   Saves the result as a *new* spreadsheet record in the `sheets` table, linked to the template, and marks it as the "active" or "canonical" version for the report source.

### Phase 3: Frontend Interactive UI
Create `frontend/src/components/builder/SpreadsheetBuilder.jsx`:
1.  **Layout**: Two-pane split screen.
    *   **Left Pane**: Source Spreadsheet (Headers and a fast preview grid showing a sample of ~50 rows, sufficient for users to understand column context and map them effectively).
    *   **Right Pane**: Target Template (List of required/optional columns).
2.  **Drag and Drop**: Utilize HTML5 DnD or `@hello-pangea/dnd` to allow users to drag a column pill from the Left Pane and drop it onto a requirement slot in the Right Pane.
3.  **Transformation Modals**: Clicking a mapped slot opens a settings panel where users can:
    *   Change mapping type to "Formula / Merge" (e.g., combining multiple dragged columns).
    *   Set a static "Default Value".
4.  **Filter Builder**: A dedicated tab/section to define row exclusion logic.
5.  **Live Preview**: A bottom pane that debounces API calls to `/builder/preview` to show the user exactly what the resulting spreadsheet will look like based on their current mappings (using the fast 50-row subset).

## 5. Verification & Testing
1.  **Backend Unit Tests**: Feed mock source rows and a complex `mapping_rules` JSON into the ETL engine to assert that math, concatenation, defaults, and row exclusion work perfectly.
2.  **API Integration Tests**: Ensure that only admins can create templates, and that generated sheets inherit the correct tenant/group permissions.
3.  **Frontend UX**: Verify the drag-and-drop state updates correctly and the preview table accurately reflects the mappings.
