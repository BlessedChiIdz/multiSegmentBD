import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import type { TableDef } from '../types';
import {
  buildSelectFirst100,
  buildSelectLast100,
  buildSelectWithCondition,
  buildSimpleSelect,
  WHERE_OPERATORS,
  type WhereOperator,
} from '../utils/sql';
import { ColumnPicker } from './ColumnPicker';

export type TableQueryMode = 'simple' | 'first100' | 'last100' | 'condition';

const TITLES: Record<TableQueryMode, string> = {
  simple: 'SELECT',
  first100: 'Выбрать 100 первых',
  last100: 'Выбрать 100 последних',
  condition: 'SELECT с условием по столбцу',
};

interface TableQueryDialogProps {
  open: boolean;
  mode: TableQueryMode | null;
  table: TableDef | null;
  onClose: () => void;
  onApply: (sql: string) => void;
}

export function TableQueryDialog({
  open,
  mode,
  table,
  onClose,
  onApply,
}: TableQueryDialogProps) {
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [whereColumn, setWhereColumn] = useState('');
  const [operator, setOperator] = useState<WhereOperator>('=');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !table) return;
    setSelectedColumns(table.columns.map((c) => c.name));
    const first = table.columns[0]?.name ?? '';
    setWhereColumn(first);
    setOperator('=');
    setValue('');
    setError(null);
  }, [open, table]);

  if (!mode || !table) {
    return null;
  }

  const needsValue =
    mode === 'condition' &&
    operator !== 'IS NULL' &&
    operator !== 'IS NOT NULL';

  const selectedWhereCol = table.columns.find((c) => c.name === whereColumn);

  const handleApply = () => {
    if (selectedColumns.length === 0) {
      setError('Выберите хотя бы один столбец');
      return;
    }
    if (mode === 'condition') {
      if (!whereColumn) {
        setError('Выберите столбец для условия');
        return;
      }
      if (needsValue && !value.trim()) {
        setError('Введите значение условия');
        return;
      }
    }

    try {
      let sql: string;
      if (mode === 'simple') {
        sql = buildSimpleSelect(table, selectedColumns);
      } else if (mode === 'first100') {
        sql = buildSelectFirst100(table, selectedColumns);
      } else if (mode === 'last100') {
        sql = buildSelectLast100(table, selectedColumns);
      } else {
        sql = buildSelectWithCondition(
          table,
          selectedColumns,
          whereColumn,
          operator,
          value,
        );
      }
      onApply(sql);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка построения SQL');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {TITLES[mode]}
        {` · ${table.name}`}
      </DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
      >
        <ColumnPicker
          table={table}
          selected={selectedColumns}
          onChange={setSelectedColumns}
        />

        {mode === 'condition' && (
          <>
            <Typography variant="subtitle2">Условие WHERE</Typography>
            <FormControl fullWidth size="small">
              <InputLabel>Столбец</InputLabel>
              <Select
                label="Столбец"
                value={whereColumn}
                onChange={(e) => setWhereColumn(e.target.value)}
              >
                {table.columns.map((col) => (
                  <MenuItem key={col.name} value={col.name}>
                    {col.name} ({col.data_type})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth size="small">
              <InputLabel>Оператор</InputLabel>
              <Select
                label="Оператор"
                value={operator}
                onChange={(e) => setOperator(e.target.value as WhereOperator)}
              >
                {WHERE_OPERATORS.map((op) => (
                  <MenuItem key={op.value} value={op.value}>
                    {op.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {needsValue && (
              <TextField
                label="Значение"
                size="small"
                fullWidth
                value={value}
                onChange={(e) => setValue(e.target.value)}
                helperText={
                  selectedWhereCol
                    ? `Тип: ${selectedWhereCol.data_type}`
                    : undefined
                }
              />
            )}
          </>
        )}

        {error && (
          <Typography variant="caption" color="error">
            {error}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button variant="contained" onClick={handleApply}>
          Вставить SQL
        </Button>
      </DialogActions>
    </Dialog>
  );
}
