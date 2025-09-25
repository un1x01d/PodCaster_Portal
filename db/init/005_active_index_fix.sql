-- Drop the old global "one active" index if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'sheets_one_active_true_idx'
  ) THEN
    EXECUTE 'DROP INDEX sheets_one_active_true_idx';
  END IF;
END $$;

-- Ensure at most one active per folder: keep the most recent, deactivate the rest
WITH ranked AS (
  SELECT
    id,
    folder_id,
    uploaded_at,
    active,
    ROW_NUMBER() OVER (
      PARTITION BY folder_id
      ORDER BY uploaded_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM sheets
  WHERE active = TRUE
)
UPDATE sheets s
SET active = FALSE
FROM ranked r
WHERE s.id = r.id
  AND r.active = TRUE
  AND r.rn > 1;

-- Optional: if a folder has no active, mark the most recent as active
WITH most_recent AS (
  SELECT DISTINCT ON (folder_id)
         id, folder_id
  FROM sheets
  ORDER BY folder_id, uploaded_at DESC NULLS LAST, id DESC
)
UPDATE sheets s
SET active = TRUE
FROM most_recent mr
WHERE s.id = mr.id
  AND NOT EXISTS (
    SELECT 1 FROM sheets s2
    WHERE s2.folder_id = s.folder_id AND s2.active = TRUE
  );

-- Create the correct per-folder unique partial index
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'sheets_one_active_per_folder_idx'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX sheets_one_active_per_folder_idx ON sheets (folder_id) WHERE active';
  END IF;
END $$;

