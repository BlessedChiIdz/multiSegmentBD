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
ORDER BY c.table_name, c.ordinal_position;
