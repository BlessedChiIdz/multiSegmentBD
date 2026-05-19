use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use crossterm::ExecutableCommand;
use ratatui::layout::{Constraint, Layout};
use ratatui::style::{Color, Modifier, Style, Stylize};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, ListState, Paragraph};
use ratatui::{Frame, Terminal};
use serde_json::Value;
use std::io::stdout;
use std::time::Duration;

#[derive(Clone, Copy, PartialEq, Eq)]
enum NodeRef {
    Segment(usize),
    Row { seg: usize, row: usize },
}

struct SegmentNode {
    name: String,
    expanded: bool,
    kind: SegmentKind,
}

enum SegmentKind {
    Ok {
        columns: Vec<String>,
        rows: Vec<RowNode>,
    },
    Err {
        message: String,
    },
}

struct RowNode {
    expanded: bool,
    cells: Vec<(String, String)>,
}

struct FlatLine {
    node: Option<NodeRef>,
    depth: usize,
    expanded: bool,
    has_children: bool,
    label: String,
    style: Style,
}

pub fn browse(results: &[Value]) -> Result<()> {
    let mut tree = build_tree(results);
    if tree.is_empty() {
        println!("Нет результатов для отображения.");
        return Ok(());
    }

    let mut stdout = stdout();
    enable_raw_mode()?;
    stdout.execute(EnterAlternateScreen)?;

    let backend = ratatui::backend::CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    let mut list_state = ListState::default();
    list_state.select(Some(0));

    let (ok, fail) = count_ok_fail(results);
    let title = format!("Результаты: {ok} OK, {fail} ошибок");

    let mut flat: Vec<FlatLine> = Vec::new();

    loop {
        rebuild_flat(&tree, &mut flat);
        clamp_selection(&flat, &mut list_state);

        terminal.draw(|f| draw_ui(f, &title, &flat, &mut list_state, results.len()))?;

        if event::poll(Duration::from_millis(50))? {
            let keys = drain_press_keys();
            let mut quit = false;
            for key in keys {
                if handle_key(key, &mut tree, &flat, &mut list_state) {
                    quit = true;
                    break;
                }
            }
            if quit {
                break;
            }
        }
    }

    disable_raw_mode()?;
    terminal.backend_mut().execute(LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    Ok(())
}

fn build_tree(results: &[Value]) -> Vec<SegmentNode> {
    results
        .iter()
        .map(|r| {
            let name = r
                .get("segment")
                .and_then(|v| v.as_str())
                .unwrap_or("?")
                .to_string();
            let ok = r.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);

            let kind = if ok {
                let columns: Vec<String> = r
                    .get("columns")
                    .and_then(|c| c.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default();

                let rows: Vec<RowNode> = r
                    .get("rows")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .map(|row_vals| {
                                let cells = columns
                                    .iter()
                                    .zip(
                                        row_vals
                                            .as_array()
                                            .map(|a| a.as_slice())
                                            .unwrap_or(&[]),
                                    )
                                    .map(|(col, val)| (col.clone(), value_display(val)))
                                    .collect();
                                RowNode {
                                    expanded: false,
                                    cells,
                                }
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();

                SegmentKind::Ok { columns, rows }
            } else {
                let message = r
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("неизвестная ошибка")
                    .to_string();
                SegmentKind::Err { message }
            };

            SegmentNode {
                name,
                expanded: true,
                kind,
            }
        })
        .collect()
}

fn value_display(v: &Value) -> String {
    match v {
        Value::Null => "NULL".into(),
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        other => other.to_string(),
    }
}

fn count_ok_fail(results: &[Value]) -> (usize, usize) {
    let ok = results
        .iter()
        .filter(|r| r.get("ok").and_then(|v| v.as_bool()) == Some(true))
        .count();
    (ok, results.len().saturating_sub(ok))
}

fn rebuild_flat(tree: &[SegmentNode], flat: &mut Vec<FlatLine>) {
    flat.clear();
    for (si, seg) in tree.iter().enumerate() {
        let (suffix, seg_style) = segment_summary(seg);
        flat.push(FlatLine {
            node: Some(NodeRef::Segment(si)),
            depth: 0,
            expanded: seg.expanded,
            has_children: true,
            label: format!("{} {suffix}", seg.name),
            style: seg_style,
        });

        if !seg.expanded {
            continue;
        }

        match &seg.kind {
            SegmentKind::Err { message } => {
                flat.push(FlatLine {
                    node: None,
                    depth: 1,
                    expanded: false,
                    has_children: false,
                    label: message.clone(),
                    style: Style::new().fg(Color::Red),
                });
            }
            SegmentKind::Ok { columns, rows } => {
                flat.push(FlatLine {
                    node: None,
                    depth: 1,
                    expanded: false,
                    has_children: false,
                    label: format!(
                        "колонки: {} | строк: {}",
                        if columns.is_empty() {
                            "—".into()
                        } else {
                            columns.join(", ")
                        },
                        rows.len()
                    ),
                    style: Style::new().fg(Color::DarkGray),
                });

                for (ri, row) in rows.iter().enumerate() {
                    flat.push(FlatLine {
                        node: Some(NodeRef::Row { seg: si, row: ri }),
                        depth: 1,
                        expanded: row.expanded,
                        has_children: !row.cells.is_empty(),
                        label: format!("строка {}", ri + 1),
                        style: Style::new().fg(Color::Cyan),
                    });

                    if row.expanded {
                        for (col, val) in &row.cells {
                            flat.push(FlatLine {
                                node: None,
                                depth: 2,
                                expanded: false,
                                has_children: false,
                                label: format!("{col}: {val}"),
                                style: Style::new().fg(Color::White),
                            });
                        }
                    }
                }
            }
        }
    }
}

fn segment_summary(seg: &SegmentNode) -> (String, Style) {
    match &seg.kind {
        SegmentKind::Err { .. } => ("[ошибка]".into(), Style::new().fg(Color::Red).bold()),
        SegmentKind::Ok { rows, .. } => (
            format!("[{} строк]", rows.len()),
            Style::new().fg(Color::Green).bold(),
        ),
    }
}

fn clamp_selection(flat: &[FlatLine], list_state: &mut ListState) {
    if flat.is_empty() {
        list_state.select(None);
        return;
    }
    let sel = list_state.selected().unwrap_or(0);
    let sel = sel.min(flat.len().saturating_sub(1));
    list_state.select(Some(sel));
}

fn toggle_node(tree: &mut [SegmentNode], node: NodeRef) {
    match node {
        NodeRef::Segment(i) => {
            if let Some(seg) = tree.get_mut(i) {
                seg.expanded = !seg.expanded;
            }
        }
        NodeRef::Row { seg, row } => {
            if let Some(SegmentNode {
                kind: SegmentKind::Ok { rows, .. },
                ..
            }) = tree.get_mut(seg)
            {
                if let Some(r) = rows.get_mut(row) {
                    r.expanded = !r.expanded;
                }
            }
        }
    }
}

fn expand_all(tree: &mut [SegmentNode], expand: bool) {
    for seg in tree.iter_mut() {
        seg.expanded = expand;
        if let SegmentKind::Ok { rows, .. } = &mut seg.kind {
            for row in rows.iter_mut() {
                row.expanded = expand;
            }
        }
    }
}

/// Считывает нажатия из очереди; для стрелок оставляет одно событие за кадр
/// (Windows часто шлёт Press + Repeat на одно нажатие).
fn drain_press_keys() -> Vec<KeyEvent> {
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

fn coalesce_navigation_keys(keys: Vec<KeyEvent>) -> Vec<KeyEvent> {
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

fn handle_key(
    key: KeyEvent,
    tree: &mut [SegmentNode],
    flat: &[FlatLine],
    list_state: &mut ListState,
) -> bool {
    if key.kind != KeyEventKind::Press {
        return false;
    }

    let len = flat.len();
    let sel = list_state.selected().unwrap_or(0);

    match key.code {
        KeyCode::Char('q') | KeyCode::Esc => return true,
        KeyCode::Up | KeyCode::Char('k') => {
            if sel > 0 {
                list_state.select(Some(sel - 1));
            }
        }
        KeyCode::Down | KeyCode::Char('j') => {
            if sel + 1 < len {
                list_state.select(Some(sel + 1));
            }
        }
        KeyCode::Home => list_state.select(Some(0)),
        KeyCode::End => {
            if len > 0 {
                list_state.select(Some(len - 1));
            }
        }
        KeyCode::PageUp => {
            let next = sel.saturating_sub(page_size());
            list_state.select(Some(next));
        }
        KeyCode::PageDown => {
            let next = (sel + page_size()).min(len.saturating_sub(1));
            list_state.select(Some(next));
        }
        KeyCode::Enter | KeyCode::Char(' ') => {
            if let Some(line) = flat.get(sel) {
                if let Some(node) = line.node {
                    toggle_node(tree, node);
                }
            }
        }
        KeyCode::Right => {
            if let Some(line) = flat.get(sel) {
                if let Some(node) = line.node {
                    set_expanded(tree, node, true);
                }
            }
        }
        KeyCode::Left => {
            if let Some(line) = flat.get(sel) {
                if let Some(node) = line.node {
                    set_expanded(tree, node, false);
                }
            }
        }
        KeyCode::Char('a') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            expand_all(tree, true);
        }
        KeyCode::Char('z') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            expand_all(tree, false);
        }
        _ => {}
    }

    false
}

fn set_expanded(tree: &mut [SegmentNode], node: NodeRef, expanded: bool) {
    match node {
        NodeRef::Segment(i) => {
            if let Some(seg) = tree.get_mut(i) {
                seg.expanded = expanded;
            }
        }
        NodeRef::Row { seg, row } => {
            if let Some(SegmentNode {
                kind: SegmentKind::Ok { rows, .. },
                ..
            }) = tree.get_mut(seg)
            {
                if let Some(r) = rows.get_mut(row) {
                    r.expanded = expanded;
                }
            }
        }
    }
}

fn page_size() -> usize {
    20
}

fn draw_ui(
    f: &mut Frame,
    title: &str,
    flat: &[FlatLine],
    list_state: &mut ListState,
    segment_count: usize,
) {
    let chunks = Layout::vertical([
        Constraint::Length(3),
        Constraint::Min(3),
        Constraint::Length(2),
    ])
    .split(f.area());

    let header = Paragraph::new(title).block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::new().fg(Color::Cyan))
            .title(" multiSectorBD "),
    );
    f.render_widget(header, chunks[0]);

    let items: Vec<ListItem> = flat
        .iter()
        .map(|line| {
            let indent = "  ".repeat(line.depth);
            let marker = if line.has_children {
                if line.expanded { "▼ " } else { "▶ " }
            } else {
                "  "
            };
            let text = Line::from(vec![
                Span::styled(format!("{indent}{marker}"), Style::new().fg(Color::DarkGray)),
                Span::styled(line.label.clone(), line.style),
            ]);
            ListItem::new(text)
        })
        .collect();

    let list = List::new(items)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(format!(" Сегментов: {segment_count} ")),
        )
        .highlight_style(
            Style::new()
                .bg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        )
        .highlight_symbol("▸ ");

    f.render_stateful_widget(list, chunks[1], list_state);

    let help = Paragraph::new(Line::from(vec![
        Span::raw("↑↓/jk — навигация  "),
        Span::raw("Space/Enter — свернуть/развернуть  "),
        Span::raw("←/→ — свернуть/развернуть  "),
        Span::raw("Ctrl+A — всё открыть  "),
        Span::raw("Ctrl+Z — всё свернуть  "),
        Span::styled("q/Esc", Style::new().fg(Color::Yellow)),
        Span::raw(" — в меню"),
    ]))
    .style(Style::new().fg(Color::DarkGray));
    f.render_widget(help, chunks[2]);
}
