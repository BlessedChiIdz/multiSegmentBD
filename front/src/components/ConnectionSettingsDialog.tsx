import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ConnectionSettingsResponse } from '../types';

interface ConnectionSettingsDialogProps {
  connectionId: string | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

function sourceLabel(settings: ConnectionSettingsResponse): string {
  if (settings.password_source === 'inline') {
    return 'segments.json';
  }
  if (settings.password_source === 'env') {
    return settings.password_env ?? 'переменная окружения';
  }
  return 'зашифрованное хранилище';
}

export function ConnectionSettingsDialog({
  connectionId,
  open,
  onClose,
  onSaved,
}: ConnectionSettingsDialogProps) {
  const [settings, setSettings] = useState<ConnectionSettingsResponse | null>(
    null,
  );
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !connectionId) {
      setSettings(null);
      setPassword('');
      setError(null);
      setTestResult(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setTestResult(null);
    setPassword('');

    void api
      .getConnectionSettings(connectionId)
      .then((data) => {
        if (!cancelled) setSettings(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Не удалось загрузить настройки');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, connectionId]);

  const handleTest = async () => {
    if (!connectionId || !settings) return;
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const usePassword =
        settings.can_edit_password && password ? password : undefined;
      const result = await api.testConnection(connectionId, usePassword);
      if (result.ok) {
        setTestResult(
          result.latency_ms != null
            ? `Подключение успешно (${result.latency_ms} ms)`
            : 'Подключение успешно',
        );
      } else {
        setTestResult(result.error ?? 'Не удалось подключиться');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Проверка подключения не удалась');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!connectionId || !settings?.can_edit_password || !password) return;
    setSaving(true);
    setError(null);
    try {
      await api.saveConnectionPassword(connectionId, password);
      setPassword('');
      const refreshed = await api.getConnectionSettings(connectionId);
      setSettings(refreshed);
      setTestResult('Пароль сохранён в зашифрованном хранилище');
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить пароль');
    } finally {
      setSaving(false);
    }
  };

  const title = settings
    ? `Подключение: ${settings.group}/${settings.name}`
    : 'Настройки подключения';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {loading && (
          <Typography variant="body2" color="text.secondary">
            Загрузка…
          </Typography>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {testResult && (
          <Alert
            severity={testResult.includes('успешно') || testResult.includes('сохранён') ? 'success' : 'warning'}
            sx={{ mb: 2 }}
          >
            {testResult}
          </Alert>
        )}

        {settings && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
            <TextField
              label="ID"
              value={settings.id}
              size="small"
              fullWidth
              InputProps={{ readOnly: true }}
            />
            <TextField
              label="Группа"
              value={settings.group}
              size="small"
              fullWidth
              InputProps={{ readOnly: true }}
            />
            <TextField
              label="Имя подключения"
              value={settings.name}
              size="small"
              fullWidth
              InputProps={{ readOnly: true }}
            />
            <TextField
              label="Хост"
              value={settings.host}
              size="small"
              fullWidth
              InputProps={{ readOnly: true }}
            />
            <TextField
              label="Порт"
              value={String(settings.port)}
              size="small"
              fullWidth
              InputProps={{ readOnly: true }}
            />
            <TextField
              label="База данных"
              value={settings.database}
              size="small"
              fullWidth
              InputProps={{ readOnly: true }}
            />
            <TextField
              label="Пользователь"
              value={settings.user}
              size="small"
              fullWidth
              InputProps={{ readOnly: true }}
            />

            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Источник пароля: {sourceLabel(settings)}
                {settings.password_configured ? ' · задан' : ' · не задан'}
              </Typography>
              {settings.password_hint && (
                <Typography variant="caption" color="text.secondary" display="block">
                  {settings.password_hint}
                </Typography>
              )}
            </Box>

            <TextField
              label="Пароль"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              size="small"
              fullWidth
              disabled={!settings.can_edit_password}
              placeholder={
                settings.password_configured
                  ? 'Введите новый пароль'
                  : 'Введите пароль'
              }
              helperText={
                settings.can_edit_password
                  ? 'Новый пароль будет сохранён в credentials.enc'
                  : 'Изменение недоступно для этого типа подключения'
              }
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
        <Button
          onClick={() => void handleTest()}
          disabled={!settings || testing || loading}
        >
          {testing ? 'Проверка…' : 'Проверить'}
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleSave()}
          disabled={
            !settings?.can_edit_password || !password || saving || loading
          }
        >
          {saving ? 'Сохранение…' : 'Сохранить пароль'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
