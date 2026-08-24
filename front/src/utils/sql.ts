import type { ColumnDef, TableDef } from '../types';

export function quoteIdent(name: string): string {
  if (/^[a-z_][a-z0-9_]*$/i.test(name)) return name;
  return `"${name.replace(/"/g, '""')}"`;
}

function formatSelectList(
  selectColumns: string[] | undefined,
  table: TableDef,
): string {
  const allNames = table.columns.map((c) => c.name);
  if (
    !selectColumns ||
    selectColumns.length === 0 ||
    selectColumns.length === allNames.length
  ) {
    return '*';
  }
  const valid = selectColumns.filter((name) =>
    table.columns.some((c) => c.name === name),
  );
  if (valid.length === 0) {
    return '*';
  }
  return valid.map(quoteIdent).join(', ');
}

export function buildSimpleSelect(
  table: TableDef,
  selectColumns?: string[],
): string {
  const cols = formatSelectList(selectColumns, table);
  return `SELECT ${cols}\nFROM ${quoteIdent(table.name)};`;
}

export function buildSelectFirst100(
  table: TableDef,
  selectColumns?: string[],
): string {
  const cols = formatSelectList(selectColumns, table);
  return `SELECT ${cols}\nFROM ${quoteIdent(table.name)}\nLIMIT 100;`;
}

export function buildSelectLast100(
  table: TableDef,
  selectColumns?: string[],
): string {
  const cols = formatSelectList(selectColumns, table);
  const orderBy = orderByForLastRows(table);
  return `SELECT ${cols}\nFROM ${quoteIdent(table.name)}\nORDER BY ${orderBy}\nLIMIT 100;`;
}

function orderByForLastRows(table: TableDef): string {
  const pkCols = table.columns.filter((c) => c.is_primary_key);
  if (pkCols.length > 0) {
    return pkCols.map((c) => `${quoteIdent(c.name)} DESC`).join(', ');
  }
  const first = table.columns[0];
  if (first) {
    return `${quoteIdent(first.name)} DESC`;
  }
  return '1 DESC';
}

export type WhereOperator =
  | '='
  | '!='
  | '>'
  | '<'
  | '>='
  | '<='
  | 'LIKE'
  | 'ILIKE'
  | 'IS NULL'
  | 'IS NOT NULL';

export const WHERE_OPERATORS: { value: WhereOperator; label: string }[] = [
  { value: '=', label: '=' },
  { value: '!=', label: '≠' },
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '≥' },
  { value: '<=', label: '≤' },
  { value: 'LIKE', label: 'LIKE' },
  { value: 'ILIKE', label: 'ILIKE' },
  { value: 'IS NULL', label: 'IS NULL' },
  { value: 'IS NOT NULL', label: 'IS NOT NULL' },
];

function isNumericType(dataType: string): boolean {
  const t = dataType.toLowerCase();
  return /^(smallint|integer|bigint|int2|int4|int8|numeric|decimal|real|double precision|float4|float8|money)/.test(
    t,
  );
}

function isBooleanType(dataType: string): boolean {
  return dataType.toLowerCase() === 'boolean';
}

export function formatSqlLiteral(value: string, column: ColumnDef): string {
  const trimmed = value.trim();
  if (isBooleanType(column.data_type)) {
    const v = trimmed.toLowerCase();
    if (v === 'true' || v === 't' || v === '1') return 'TRUE';
    if (v === 'false' || v === 'f' || v === '0') return 'FALSE';
  }
  if (isNumericType(column.data_type)) {
    return trimmed;
  }
  return `'${trimmed.replace(/'/g, "''")}'`;
}

export function buildSelectWithCondition(
  table: TableDef,
  selectColumns: string[] | undefined,
  columnName: string,
  operator: WhereOperator,
  value: string,
): string {
  const column = table.columns.find((c) => c.name === columnName);
  if (!column) {
    throw new Error(`Column ${columnName} not found`);
  }

  const cols = formatSelectList(selectColumns, table);
  const col = quoteIdent(column.name);
  let where: string;
  if (operator === 'IS NULL' || operator === 'IS NOT NULL') {
    where = `${col} ${operator}`;
  } else {
    const literal = formatSqlLiteral(value, column);
    where = `${col} ${operator} ${literal}`;
  }

  return `SELECT ${cols}\nFROM ${quoteIdent(table.name)}\nWHERE ${where}\nLIMIT 100;`;
}
