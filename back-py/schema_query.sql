SELECT
    c.table_name,
    c.column_name,
    c.data_type,
    c.character_maximum_length,
    c.is_nullable,
    CASE WHEN pk.constraint_type = 'PRIMARY KEY' THEN 'YES' ELSE 'NO' END AS is_primary_key
FROM information_schema.columns c
LEFT JOIN (
    SELECT
        kcu.table_name,
        kcu.column_name,
        tc.constraint_type
    FROM information_schema.key_column_usage kcu
    JOIN information_schema.table_constraints tc
        ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public'
) pk ON c.table_name = pk.table_name
     AND c.column_name = pk.column_name
WHERE c.table_schema = 'public'
  AND c.table_name IN (
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
  )
  -- не показывать партиции (ppac_account_pool_logs_2026_05_24 и т.п.)
  AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_inherits inh
      JOIN pg_catalog.pg_class child ON child.oid = inh.inhrelid
      JOIN pg_catalog.pg_namespace ns ON ns.oid = child.relnamespace
      WHERE ns.nspname = c.table_schema
        AND child.relname = c.table_name
  )
ORDER BY c.table_name, c.ordinal_position;
