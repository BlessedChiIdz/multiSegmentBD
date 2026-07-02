import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import {
  AppBar,
  Box,
  Button,
  Chip,
  Toolbar as MuiToolbar,
  Typography,
} from '@mui/material';
import type { StatusResponse } from '../types';

interface ToolbarProps {
  status: StatusResponse | null;
  connected: boolean;
  running: boolean;
  autocommit: boolean;
  onRun: () => void;
  onCancel: () => void;
}

export function Toolbar({
  status,
  connected,
  running,
  autocommit,
  onRun,
  onCancel,
}: ToolbarProps) {
  return (
    <AppBar
      position="static"
      color="default"
      elevation={0}
      sx={{ borderBottom: 1, borderColor: 'divider' }}
    >
      <MuiToolbar variant="dense" sx={{ gap: 1 }}>
        <Typography variant="h6" sx={{ fontSize: 16, fontWeight: 600, mr: 1 }}>
          multiSegmentBD
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<PlayArrowIcon />}
          onClick={onRun}
          disabled={running || !connected}
        >
          Run
        </Button>
        {running && (
          <Button
            variant="outlined"
            size="small"
            color="error"
            startIcon={<StopIcon />}
            onClick={onCancel}
          >
            Stop all
          </Button>
        )}
        <Chip
          size="small"
          label={autocommit ? 'Autocommit' : 'Transaction'}
          color={autocommit ? 'default' : 'warning'}
          variant="outlined"
        />
        <Box sx={{ flex: 1 }} />
        {status && (
          <>
            <Chip
              size="small"
              label={connected ? 'Connected' : 'Offline'}
              color={connected ? 'success' : 'default'}
              variant="outlined"
            />
            <Typography variant="caption" color="text.secondary" noWrap>
              {status.table_count} tables · timeout {status.connect_timeout_secs}s
              · parallel {status.max_concurrent_segments}
            </Typography>
          </>
        )}
      </MuiToolbar>
    </AppBar>
  );
}
