import { Box, TextField } from '@mui/material';

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function SqlEditor({ value, onChange }: SqlEditorProps) {
  return (
    <Box
      sx={{
        flex: '0 0 auto',
        minHeight: 160,
        maxHeight: '40%',
        borderBottom: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <TextField
        multiline
        fullWidth
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="SELECT * FROM ...  (только SELECT)"
        variant="standard"
        InputProps={{
          disableUnderline: true,
          sx: {
            fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
            fontSize: 13,
            lineHeight: 1.5,
            p: 1.5,
            height: '100%',
            alignItems: 'flex-start',
          },
        }}
        sx={{
          flex: 1,
          '& .MuiInputBase-root': { height: '100%', alignItems: 'stretch' },
          '& textarea': { height: '100% !important', overflow: 'auto !important' },
        }}
      />
    </Box>
  );
}
