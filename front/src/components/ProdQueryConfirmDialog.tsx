import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material';
import type { ConnectionGroup } from '../types';

export function prodSegmentIds(
  groups: ConnectionGroup[],
  targetIds: string[],
): string[] {
  const targets = new Set(targetIds);
  const ids: string[] = [];
  for (const group of groups) {
    if (!group.alert) continue;
    for (const conn of group.connections) {
      if (targets.has(conn.id)) {
        ids.push(conn.id);
      }
    }
  }
  return ids;
}

function segmentLabel(groups: ConnectionGroup[], id: string): string {
  for (const group of groups) {
    for (const conn of group.connections) {
      if (conn.id === id) {
        return `${group.name} / ${conn.name} (${conn.database})`;
      }
    }
  }
  return id;
}

interface ProdQueryConfirmDialogProps {
  open: boolean;
  groups: ConnectionGroup[];
  segmentIds: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function ProdQueryConfirmDialog({
  open,
  groups,
  segmentIds,
  onConfirm,
  onCancel,
}: ProdQueryConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          color: 'error.main',
        }}
      >
        <WarningAmberIcon />
        Запрос на PROD
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 1.5 }}>
          Вы собираетесь выполнить SQL на{' '}
          <strong>{segmentIds.length}</strong>{' '}
          {segmentIds.length === 1 ? 'production-подключении' : 'production-подключениях'}.
          Подтвердите, что это намеренно.
        </Typography>
        <Box
          sx={{
            border: 1,
            borderColor: 'error.light',
            borderRadius: 1,
            bgcolor: (theme) =>
              theme.palette.mode === 'dark'
                ? 'rgba(211, 47, 47, 0.12)'
                : 'rgba(211, 47, 47, 0.06)',
          }}
        >
          <List dense disablePadding>
            {segmentIds.map((id) => (
              <ListItem key={id} disableGutters sx={{ px: 1.5 }}>
                <ListItemText
                  primary={segmentLabel(groups, id)}
                  primaryTypographyProps={{
                    variant: 'body2',
                    color: 'error.main',
                    fontWeight: 600,
                  }}
                />
              </ListItem>
            ))}
          </List>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel}>Отмена</Button>
        <Button variant="contained" color="error" onClick={onConfirm}>
          Выполнить на PROD
        </Button>
      </DialogActions>
    </Dialog>
  );
}
