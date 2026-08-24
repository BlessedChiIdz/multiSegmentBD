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
import StorageIcon from '@mui/icons-material/Storage';
import type { SegmentInfo } from '../types';

interface SegmentPanelProps {
  segments: SegmentInfo[];
  selected: string[];
  stopOnFirstMatch: boolean;
  onSelectedChange: (names: string[]) => void;
  onStopOnFirstMatchChange: (value: boolean) => void;
}

export function SegmentPanel({
  segments,
  selected,
  stopOnFirstMatch,
  onSelectedChange,
  onStopOnFirstMatchChange,
}: SegmentPanelProps) {
  const allSelected =
    segments.length > 0 && selected.length === segments.length;
  const noneSelected = selected.length === 0;

  const toggleAll = () => {
    if (allSelected || noneSelected) {
      onSelectedChange(segments.map((s) => s.name));
    } else {
      onSelectedChange([]);
    }
  };

  const toggleOne = (name: string) => {
    if (selected.includes(name)) {
      onSelectedChange(selected.filter((n) => n !== name));
    } else {
      onSelectedChange([...selected, name]);
    }
  };

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Typography variant="subtitle2">Segments</Typography>
        <Typography variant="caption" color="text.secondary">
          {noneSelected ? 'all' : `${selected.length} selected`}
        </Typography>
      </Box>

      <List dense disablePadding sx={{ overflow: 'auto', flex: 1 }}>
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
              primary="All segments"
              primaryTypographyProps={{ variant: 'body2' }}
            />
          </ListItemButton>
        </ListItem>
        {segments.map((seg) => (
          <ListItem key={seg.name} disablePadding>
            <ListItemButton onClick={() => toggleOne(seg.name)} dense>
              <ListItemIcon sx={{ minWidth: 36 }}>
                <Checkbox
                  edge="start"
                  checked={selected.includes(seg.name)}
                  tabIndex={-1}
                  disableRipple
                  size="small"
                />
              </ListItemIcon>
              <ListItemIcon sx={{ minWidth: 28 }}>
                <StorageIcon sx={{ fontSize: 18, opacity: 0.7 }} />
              </ListItemIcon>
              <ListItemText
                primary={seg.name}
                secondary={`${seg.host}:${seg.port}/${seg.database}`}
                primaryTypographyProps={{ variant: 'body2' }}
                secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>

      <Box sx={{ px: 1.5, py: 0.5, borderTop: 1, borderColor: 'divider' }}>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={stopOnFirstMatch}
              onChange={(_, v) => onStopOnFirstMatchChange(v)}
            />
          }
          label={
            <Typography variant="caption">Stop on first match</Typography>
          }
        />
      </Box>
    </Box>
  );
}
