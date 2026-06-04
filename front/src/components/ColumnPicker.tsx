import {
  Box,
  Checkbox,
  FormControlLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';
import KeyIcon from '@mui/icons-material/Key';
import type { TableDef } from '../types';

interface ColumnPickerProps {
  table: TableDef;
  selected: string[];
  onChange: (columns: string[]) => void;
}

export function ColumnPicker({ table, selected, onChange }: ColumnPickerProps) {
  const allNames = table.columns.map((c) => c.name);
  const allSelected =
    allNames.length > 0 && selected.length === allNames.length;
  const noneSelected = selected.length === 0;

  const toggleAll = () => {
    onChange(allSelected ? [] : allNames);
  };

  const toggleOne = (name: string) => {
    if (selected.includes(name)) {
      onChange(selected.filter((n) => n !== name));
    } else {
      onChange([...selected, name]);
    }
  };

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 0.5,
        }}
      >
        <Typography variant="subtitle2">Столбцы SELECT</Typography>
        <Typography variant="caption" color="text.secondary">
          {selected.length} / {allNames.length}
        </Typography>
      </Box>

      <List
        dense
        disablePadding
        sx={{
          maxHeight: 200,
          overflow: 'auto',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
        }}
      >
        <ListItem disablePadding>
          <ListItemButton onClick={toggleAll} dense>
            <ListItemIcon sx={{ minWidth: 36 }}>
              <Checkbox
                edge="start"
                checked={allSelected}
                indeterminate={!allSelected && !noneSelected}
                tabIndex={-1}
                disableRipple
                size="small"
              />
            </ListItemIcon>
            <ListItemText
              primary="Все столбцы"
              primaryTypographyProps={{ variant: 'body2' }}
            />
          </ListItemButton>
        </ListItem>
        {table.columns.map((col) => (
          <ListItem key={col.name} disablePadding>
            <ListItemButton onClick={() => toggleOne(col.name)} dense>
              <ListItemIcon sx={{ minWidth: 36 }}>
                <Checkbox
                  edge="start"
                  checked={selected.includes(col.name)}
                  tabIndex={-1}
                  disableRipple
                  size="small"
                />
              </ListItemIcon>
              {col.is_primary_key && (
                <KeyIcon
                  sx={{ fontSize: 14, color: 'warning.main', mr: 0.5 }}
                />
              )}
              <ListItemText
                primary={col.name}
                secondary={col.data_type}
                primaryTypographyProps={{
                  variant: 'body2',
                  fontFamily: 'monospace',
                }}
                secondaryTypographyProps={{ variant: 'caption' }}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  );
}
