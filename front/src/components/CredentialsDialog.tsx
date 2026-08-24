import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import type { ConnectionGroup } from '../types';

export type CredentialsDialogMode = 'setup' | 'unlock' | 'missing';

interface CredentialsDialogProps {
  open: boolean;
  mode: CredentialsDialogMode;
  groups: ConnectionGroup[];
  missingIds: string[];
  credentialsPath: string;
  submitting: boolean;
  error: string | null;
  onSubmit: (payload: {
    masterPassword: string;
    passwords: Record<string, string>;
  }) => void;
  onClose?: () => void;
}

function connectionLabel(groups: ConnectionGroup[], id: string): string {
  for (const group of groups) {
    for (const conn of group.connections) {
      if (conn.id === id) {
        return `${group.name}/${conn.name}`;
      }
    }
  }
  return id;
}

export function CredentialsDialog({
  open,
  mode,
  groups,
  missingIds,
  credentialsPath,
  submitting,
  error,
  onSubmit,
  onClose,
}: CredentialsDialogProps) {
  const [masterPassword, setMasterPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [sameForAll, setSameForAll] = useState(true);
  const [sharedPassword, setSharedPassword] = useState('');
  const [passwords, setPasswords] = useState<Record<string, string>>({});

  const targetIds = useMemo(() => {
    if (mode === 'missing') return missingIds;
    return groups.flatMap((g) => g.connections.map((c) => c.id));
  }, [mode, missingIds, groups]);

  useEffect(() => {
    if (!open) return;
    setMasterPassword('');
    setConfirmPassword('');
    setSharedPassword('');
    setPasswords(Object.fromEntries(targetIds.map((id) => [id, ''])));
  }, [open, targetIds]);

  const title =
    mode === 'setup'
      ? 'Сохранить пароли подключений'
      : mode === 'unlock'
        ? 'Разблокировать хранилище паролей'
        : 'Добавить пароли подключений';

  const canSubmit = () => {
    if (mode !== 'missing' && !masterPassword) return false;
    if (mode === 'setup' && masterPassword !== confirmPassword) return false;
    if (mode === 'unlock') return true;
    if (sameForAll) return sharedPassword.length > 0;
    return targetIds.every((id) => (passwords[id] ?? '').length > 0);
  };

  const handleSubmit = () => {
    const resolved: Record<string, string> = {};
    if (mode !== 'unlock') {
      for (const id of targetIds) {
        resolved[id] = sameForAll ? sharedPassword : (passwords[id] ?? '');
      }
    }
    onSubmit({ masterPassword, passwords: resolved });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {mode !== 'missing' && (
          <TextField
            fullWidth
            type="password"
            label="Мастер-пароль"
            value={masterPassword}
            onChange={(e) => setMasterPassword(e.target.value)}
            margin="normal"
            autoFocus
          />
        )}

        {mode === 'setup' && (
          <TextField
            fullWidth
            type="password"
            label="Подтвердите мастер-пароль"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            margin="normal"
            error={
              confirmPassword.length > 0 && masterPassword !== confirmPassword
            }
            helperText={
              confirmPassword.length > 0 && masterPassword !== confirmPassword
                ? 'Пароли не совпадают'
                : ' '
            }
          />
        )}

        {mode !== 'unlock' && (
          <Box sx={{ mt: 1 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={sameForAll}
                  onChange={(e) => setSameForAll(e.target.checked)}
                />
              }
              label="Один пароль для всех подключений"
            />

            {sameForAll ? (
              <TextField
                fullWidth
                type="password"
                label="Пароль БД"
                value={sharedPassword}
                onChange={(e) => setSharedPassword(e.target.value)}
                margin="normal"
              />
            ) : (
              targetIds.map((id) => (
                <TextField
                  key={id}
                  fullWidth
                  type="password"
                  label={connectionLabel(groups, id)}
                  value={passwords[id] ?? ''}
                  onChange={(e) =>
                    setPasswords((prev) => ({ ...prev, [id]: e.target.value }))
                  }
                  margin="normal"
                />
              ))
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {onClose && (
          <Button onClick={onClose} disabled={submitting}>
            Отмена
          </Button>
        )}
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!canSubmit() || submitting}
        >
          {mode === 'unlock' ? 'Разблокировать' : 'Сохранить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
