import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import KeyIcon from '@mui/icons-material/Key';
import RefreshIcon from '@mui/icons-material/Refresh';
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import {
  Box,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material';
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';
import { useState } from 'react';
import type { DatabaseSchema, TableDef } from '../types';
import { buildSelectFirst100 } from '../utils/sql';
import {
  TableQueryDialog,
  type TableQueryMode,
} from './TableQueryDialog';

interface SchemaExplorerProps {
  schema: DatabaseSchema | null;
  schemaSource: string;
  loading: boolean;
  onReload: () => void;
  onSetSql: (sql: string) => void;
  onInsertColumn: (table: TableDef, columnName: string) => void;
}

function columnLabel(col: TableDef['columns'][0]): string {
  const nullable = col.is_nullable ? 'NULL' : 'NOT NULL';
  const len = col.char_max_len != null ? `(${col.char_max_len})` : '';
  return `${col.name}: ${col.data_type}${len} ${nullable}`;
}

export function SchemaExplorer({
  schema,
  schemaSource,
  loading,
  onReload,
  onSetSql,
  onInsertColumn,
}: SchemaExplorerProps) {
  const tables = schema?.tables ?? [];

  const [menuAnchor, setMenuAnchor] = useState<{
    mouseX: number;
    mouseY: number;
  } | null>(null);
  const [menuTable, setMenuTable] = useState<TableDef | null>(null);
  const [queryDialog, setQueryDialog] = useState<{
    mode: TableQueryMode;
    table: TableDef;
  } | null>(null);

  const openTableMenu = (e: React.MouseEvent, table: TableDef) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuTable(table);
    setMenuAnchor({ mouseX: e.clientX, mouseY: e.clientY });
  };

  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuTable(null);
  };

  const openQueryDialog = (mode: TableQueryMode) => {
    if (menuTable) {
      setQueryDialog({ mode, table: menuTable });
    }
    setMenuAnchor(null);
  };

  const closeQueryDialog = () => {
    setQueryDialog(null);
    setMenuTable(null);
  };

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap>
            Database
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            public · {tables.length} tables
            {schemaSource ? ` · ref: ${schemaSource}` : ''}
          </Typography>
        </Box>
        <Tooltip title="Reload schema">
          <span>
            <IconButton size="small" onClick={onReload} disabled={loading}>
              {loading ? (
                <CircularProgress size={18} />
              ) : (
                <RefreshIcon fontSize="small" />
              )}
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', p: 0.5 }}>
        {tables.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ p: 2, textAlign: 'center' }}
          >
            No tables loaded
          </Typography>
        ) : (
          <SimpleTreeView
            slots={{
              collapseIcon: ExpandMoreIcon,
              expandIcon: ChevronRightIcon,
            }}
            defaultExpandedItems={tables.length > 0 ? ['schema-root'] : []}
          >
            <TreeItem itemId="schema-root" label="public">
              {tables.map((table) => (
                <TreeItem
                  key={table.name}
                  itemId={`table-${table.name}`}
                  label={
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        py: 0.25,
                      }}
                      onContextMenu={(e) => openTableMenu(e, table)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        onSetSql(buildSelectFirst100(table));
                      }}
                    >
                      <TableChartIcon sx={{ fontSize: 16, opacity: 0.7 }} />
                      <Typography variant="body2" component="span">
                        {table.name}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        component="span"
                      >
                        ({table.columns.length})
                      </Typography>
                    </Box>
                  }
                >
                  {table.columns.map((col) => (
                    <TreeItem
                      key={`${table.name}.${col.name}`}
                      itemId={`col-${table.name}-${col.name}`}
                      label={
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5,
                            py: 0.25,
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            onInsertColumn(table, col.name);
                          }}
                        >
                          {col.is_primary_key ? (
                            <KeyIcon
                              sx={{ fontSize: 14, color: 'warning.main' }}
                            />
                          ) : (
                            <ViewColumnIcon
                              sx={{ fontSize: 14, opacity: 0.6 }}
                            />
                          )}
                          <Typography
                            variant="caption"
                            component="span"
                            sx={{ fontFamily: 'monospace' }}
                          >
                            {columnLabel(col)}
                          </Typography>
                        </Box>
                      }
                    />
                  ))}
                </TreeItem>
              ))}
            </TreeItem>
          </SimpleTreeView>
        )}
      </Box>

      <Menu
        open={menuAnchor !== null}
        onClose={closeMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          menuAnchor
            ? { top: menuAnchor.mouseY, left: menuAnchor.mouseX }
            : undefined
        }
      >
        <MenuItem onClick={() => openQueryDialog('simple')}>
          SELECT…
        </MenuItem>
        <MenuItem onClick={() => openQueryDialog('first100')}>
          Выбрать 100 первых…
        </MenuItem>
        <MenuItem onClick={() => openQueryDialog('last100')}>
          Выбрать 100 последних…
        </MenuItem>
        <MenuItem onClick={() => openQueryDialog('condition')}>
          SELECT с условием по столбцу…
        </MenuItem>
      </Menu>

      <TableQueryDialog
        open={queryDialog !== null}
        mode={queryDialog?.mode ?? null}
        table={queryDialog?.table ?? menuTable}
        onClose={closeQueryDialog}
        onApply={onSetSql}
      />
    </Box>
  );
}
