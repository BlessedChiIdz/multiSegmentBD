use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use crossterm::ExecutableCommand;
use ratatui::{backend::CrosstermBackend, Terminal};
use std::io::stdout;
use std::time::Duration;

pub struct TerminalGuard {
    terminal: Terminal<CrosstermBackend<std::io::Stdout>>,
}

impl TerminalGuard {
    pub fn enter() -> Result<Self> {
        let mut out = stdout();
        enable_raw_mode()?;
        out.execute(EnterAlternateScreen)?;
        let terminal = Terminal::new(CrosstermBackend::new(out))?;
        Ok(Self { terminal })
    }

    pub fn terminal_mut(&mut self) -> &mut Terminal<CrosstermBackend<std::io::Stdout>> {
        &mut self.terminal
    }
}

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let _ = self.terminal.backend_mut().execute(LeaveAlternateScreen);
        let _ = self.terminal.show_cursor();
    }
}

pub fn drain_press_keys() -> Vec<crossterm::event::KeyEvent> {
    let mut keys = Vec::new();
    loop {
        match event::read() {
            Ok(Event::Key(k)) if k.kind == KeyEventKind::Press => keys.push(k),
            Ok(_) => {}
            Err(_) => break,
        }
        if !event::poll(Duration::ZERO).unwrap_or(false) {
            break;
        }
    }
    coalesce_navigation_keys(keys)
}

pub fn coalesce_navigation_keys(
    keys: Vec<crossterm::event::KeyEvent>,
) -> Vec<crossterm::event::KeyEvent> {
    if keys.len() <= 1 {
        return keys;
    }
    let mut out = Vec::with_capacity(keys.len());
    let mut i = 0;
    while i < keys.len() {
        let code = keys[i].code;
        if matches!(
            code,
            KeyCode::Up | KeyCode::Down | KeyCode::PageUp | KeyCode::PageDown
        ) {
            let mut j = i + 1;
            while j < keys.len() && keys[j].code == code {
                j += 1;
            }
            out.push(keys[j - 1].clone());
            i = j;
        } else {
            out.push(keys[i].clone());
            i += 1;
        }
    }
    out
}

pub fn poll_keys(timeout_ms: u64) -> Result<Vec<crossterm::event::KeyEvent>> {
    if event::poll(Duration::from_millis(timeout_ms))? {
        Ok(drain_press_keys())
    } else {
        Ok(Vec::new())
    }
}
