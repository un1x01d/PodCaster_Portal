-- Add group_id to sheets; keep existing data valid
ALTER TABLE IF EXISTS sheets
  ADD COLUMN IF NOT EXISTS group_id INT;

-- Optional FK to groups
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'sheets_group_fk'
  ) THEN
    ALTER TABLE sheets
      ADD CONSTRAINT sheets_group_fk
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL;
  END IF;
END $$;

-- One active sheet *per group*
DROP INDEX IF EXISTS sheets_one_active_true_idx;
CREATE UNIQUE INDEX IF NOT EXISTS sheets_one_active_true_per_group
  ON sheets (group_id, active) WHERE active;

-- Seed a default group if none exists (so admins can upload right away)
INSERT INTO groups(name)
SELECT 'General'
WHERE NOT EXISTS (SELECT 1 FROM groups);

-- If historical rows had NULL group_id, assign them to 'General'
UPDATE sheets s
SET group_id = g.id
FROM groups g
WHERE s.group_id IS NULL AND g.name = 'General';

