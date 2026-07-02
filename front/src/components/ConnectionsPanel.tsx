import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FolderIcon from '@mui/icons-material/Folder';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import RefreshIcon from '@mui/icons-material/Refresh';
import StopIcon from '@mui/icons-material/Stop';
import StorageIcon from '@mui/icons-material/Storage';
import {
  Box,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material';
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';
import type {
  ConnectionGroup,
  ConnectionInfo,
  SegmentHealthInfo,
  SegmentRunStatus,
} from '../types';

interface ConnectionsPanelProps {
  groups: ConnectionGroup[];
  selected: string[];
  autocommit: boolean;
  stopOnFirstMatch: boolean;
  segmentRunStatus: Record<string, SegmentRunStatus>;
  segmentHealth: Record<string, SegmentHealthInfo>;
  healthChecking: boolean;
  onSelectedChange: (ids: string[]) => void;
  onAutocommitChange: (value: boolean) => void;
  onStopOnFirstMatchChange: (value: boolean) => void;
  onCancelSegment: (id: string) => void;
  onRefreshHealth: () => void;
}

function allConnections(groups: ConnectionGroup[]): ConnectionInfo[] {
  return groups.flatMap((g) => g.connections);
}

function statusChip(
  status: SegmentRunStatus | undefined,
  onCancel: () => void,
) {
  if (!status || status === 'pending') {
    return null;
  }
  if (status === 'running') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, ml: 'auto' }}>
        <Chip
          size="small"
          label="running"
          color="info"
          icon={<CircularProgress size={10} color="inherit" />}
          sx={{ height: 20, '& .MuiChip-icon': { ml: 0.5 } }}
        />
        <Tooltip title="Stop query on this connection">
          <IconButton
            size="small"
            color="error"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            sx={{ p: 0.25 }}
          >
            <StopIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>
    );
  }
  if (status === 'cancelled') {
    return (
      <Chip size="small" label="cancelled" color="warning" sx={{ height: 20, ml: 'auto' }} />
    );
  }
  if (status === 'error') {
    return (
      <Chip size="small" label="error" color="error" sx={{ height: 20, ml: 'auto' }} />
    );
  }
  if (status === 'completed') {
    return (
      <Chip size="small" label="done" color="success" variant="outlined" sx={{ height: 20, ml: 'auto' }} />
    );
  }
  return null;
}

function reachabilityIcon(
  connId: string,
  health: Record<string, SegmentHealthInfo>,
  checking: boolean,
) {
  if (checking && !health[connId]) {
    return (
      <CircularProgress size={14} sx={{ mt: 0.25 }} />
    );
  }

  const item = health[connId];
  if (!item) {
    return <LinkOffIcon sx={{ fontSize: 16, mt: 0.3, opacity: 0.4 }} />;
  }

  if (item.ok) {
    const tip =
      item.latency_ms != null ? `online · ${item.latency_ms} ms` : 'online';
    return (
      <Tooltip title={tip}>
        <StorageIcon sx={{ fontSize: 16, mt: 0.3, color: 'success.main' }} />
      </Tooltip>
    );
  }

  return (
    <Tooltip title={item.error ?? 'offline'}>
      <LinkOffIcon sx={{ fontSize: 16, mt: 0.3, color: 'error.main' }} />
    </Tooltip>
  );
}

function connectionLabel(
  conn: ConnectionInfo,
  active: boolean,
  checked: boolean,
  runStatus: SegmentRunStatus | undefined,
  health: Record<string, SegmentHealthInfo>,
  healthChecking: boolean,
  onToggle: () => void,
  onCancel: () => void,
) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 0.5,
        py: 0.25,
        opacity: active ? 1 : 0.55,
        width: '100%',
        pr: 0.5,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <Checkbox
        size="small"
        checked={checked}
        tabIndex={-1}
        disableRipple
        sx={{ p: 0.25, mt: 0.1 }}
      />
      {reachabilityIcon(conn.id, health, healthChecking)}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" noWrap>
          {conn.database}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {conn.name} · {conn.user}@{conn.host}:{conn.port}
        </Typography>
      </Box>
      {statusChip(runStatus, onCancel)}
    </Box>
  );
}

export function ConnectionsPanel({
  groups,
  selected,
  autocommit,
  stopOnFirstMatch,
  segmentRunStatus,
  segmentHealth,
  healthChecking,
  onSelectedChange,
  onAutocommitChange,
  onStopOnFirstMatchChange,
  onCancelSegment,
  onRefreshHealth,
}: ConnectionsPanelProps) {
  const connections = allConnections(groups);
  const allIds = connections.map((c) => c.id);
  const onlineCount = connections.filter((c) => segmentHealth[c.id]?.ok).length;

  const allSelected =
    connections.length > 0 && selected.length === connections.length;
  const noneSelected = selected.length === 0;
  const activeCount = noneSelected ? connections.length : selected.length;

  const isActive = (id: string) => noneSelected || selected.includes(id);

  const toggleAll = () => {
    if (allSelected || noneSelected) {
      onSelectedChange(allIds);
    } else {
      onSelectedChange([]);
    }
  };

  const toggleOne = (id: string) => {
    if (selected.includes(id)) {
      onSelectedChange(selected.filter((n) => n !== id));
    } else {
      onSelectedChange([...selected, id]);
    }
  };

  const toggleGroup = (group: ConnectionGroup) => {
    const ids = group.connections.map((c) => c.id);
    const allInGroup = ids.every((id) => selected.includes(id));
    if (allInGroup) {
      onSelectedChange(selected.filter((id) => !ids.includes(id)));
    } else {
      onSelectedChange(Array.from(new Set([...selected, ...ids])));
    }
  };

  const groupCheckboxState = (group: ConnectionGroup) => {
    const ids = group.connections.map((c) => c.id);
    const count = ids.filter((id) => selected.includes(id)).length;
    return {
      checked: count > 0 && count === ids.length,
      indeterminate: count > 0 && count < ids.length,
    };
  };

  const expandedIds = [
    'connections-root',
    ...groups.map((g) => `group-${g.name}`),
  ];

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
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 1,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2">Connections</Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            {activeCount} of {connections.length} selected · {groups.length} groups
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            {healthChecking
              ? 'Checking availability…'
              : `${onlineCount}/${connections.length} online`}
          </Typography>
        </Box>
        <Tooltip title="Check connections">
          <span>
            <IconButton
              size="small"
              onClick={onRefreshHealth}
              disabled={healthChecking || connections.length === 0}
            >
              {healthChecking ? (
                <CircularProgress size={18} />
              ) : (
                <RefreshIcon fontSize="small" />
              )}
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', p: 0.5 }}>
        {connections.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ p: 2, textAlign: 'center' }}
          >
            No connections
          </Typography>
        ) : (
          <SimpleTreeView
            slots={{
              collapseIcon: ExpandMoreIcon,
              expandIcon: ChevronRightIcon,
            }}
            defaultExpandedItems={expandedIds}
          >
            <TreeItem
              itemId="connections-root"
              label={
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    py: 0.25,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleAll();
                  }}
                >
                  <Checkbox
                    size="small"
                    checked={allSelected}
                    indeterminate={!allSelected && !noneSelected}
                    tabIndex={-1}
                    disableRipple
                    sx={{ p: 0.25 }}
                  />
                  <LinkIcon sx={{ fontSize: 16, opacity: 0.7 }} />
                  <Typography variant="body2" fontWeight={600}>
                    All connections
                  </Typography>
                </Box>
              }
            >
              {groups.map((group) => {
                const gState = groupCheckboxState(group);
                return (
                  <TreeItem
                    key={group.name}
                    itemId={`group-${group.name}`}
                    label={
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.5,
                          py: 0.25,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleGroup(group);
                        }}
                      >
                        <Checkbox
                          size="small"
                          checked={gState.checked}
                          indeterminate={gState.indeterminate}
                          tabIndex={-1}
                          disableRipple
                          sx={{ p: 0.25 }}
                        />
                        <FolderIcon sx={{ fontSize: 16, color: 'warning.main' }} />
                        <Typography variant="body2" fontWeight={600}>
                          {group.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          ({group.connections.length})
                        </Typography>
                      </Box>
                    }
                  >
                    {group.connections.map((conn) => (
                      <TreeItem
                        key={conn.id}
                        itemId={`conn-${conn.id}`}
                        label={connectionLabel(
                          conn,
                          isActive(conn.id),
                          selected.includes(conn.id),
                          segmentRunStatus[conn.id],
                          segmentHealth,
                          healthChecking,
                          () => toggleOne(conn.id),
                          () => onCancelSegment(conn.id),
                        )}
                      />
                    ))}
                  </TreeItem>
                );
              })}
            </TreeItem>
          </SimpleTreeView>
        )}
      </Box>

      <Box
        sx={{
          px: 1.5,
          py: 1,
          borderTop: 1,
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
        }}
      >
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={autocommit}
              onChange={(_, v) => onAutocommitChange(v)}
            />
          }
          label={
            <Typography variant="caption">
              Autocommit {autocommit ? 'ON' : 'OFF (BEGIN…COMMIT)'}
            </Typography>
          }
        />
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
