use crate::schema::{ColumnDef, DatabaseSchema, TableDef};
use crate::tui::util::{poll_keys, TerminalGuard};
use anyhow::Result;
use crossterm::event::{KeyCode, KeyEvent, KeyEventKind};
use ratatui::layout::{Constraint, Layout};
use ratatui::style::{Color, Modifier, Style, Stylize};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, ListState, Paragraph};
use ratatui::Frame;

#[derive(Clone, Copy)]
enum NodeRef {
    Table(usize),
}

struct TableNode {
    table: TableDef,
    expanded: bool,
}

struct FlatLine {
    node: Option<NodeRef>,
    depth: usize,
    expanded: bool,
    has_children: bool,
    label: String,
    style: Style,
}

pub fn browse(schema: &DatabaseSchema, source: &str) -> Result<()> {
    let mut tree: Vec<TableNode> = schema
        .tables
        .iter()
        .cloned()
        .map(|table| TableNode {
            table,
            expanded: false,
        })
        .collect();

    let mut guard = TerminalGuard::enter()?;
    let mut list_state = ListState::default();
    list_state.select(Some(0));
    let mut flat = Vec::new();

    let title = format!("Схема БД (эталон: {source}) — {} таблиц", schema.tables.len());

    loop {
        rebuild_flat(&tree, &mut flat);
        clamp_selection(&flat, &mut list_state);

        guard
            .terminal_mut()
            .draw(|f| draw(f, &title, &flat, &mut list_state))?;

        let mut quit = false;
        for key in poll_keys(50)? {
            if key.kind != KeyEventKind::Press {
                continue;
            }
            if handle_key(key, &mut tree, &flat, &mut list_state) {
                quit = true;
                break;
            }
        }
        if quit {
            break;
        }
    }

    Ok(())
}

fn rebuild_flat(tree: &[TableNode], flat: &mut Vec<FlatLine>) {
    flat.clear();
    for (ti, node) in tree.iter().enumerate() {
        flat.push(FlatLine {
            node: Some(NodeRef::Table(ti)),
            depth: 0,
            expanded: node.expanded,
            has_children: !node.table.columns.is_empty(),
            label: format!(
                "{} [{} кол.]",
                node.table.name,
                node.table.columns.len()
            ),
            style: Style::new().fg(Color::Green).bold(),
        });
        if !node.expanded {
            continue;
        }
        for col in &node.table.columns {
            flat.push(FlatLine {
                node: None,
                depth: 1,
                expanded: false,
                has_children: false,
                label: format_column(col),
                style: column_style(col),
            });
        }
    }
}

fn format_column(c: &ColumnDef) -> String {
    let mut type_s = c.data_type.clone();
    if let Some(len) = c.char_max_len {
        type_s.push_str(&format!("({len})"));
    }
    let null = if c.is_nullable { "NULL" } else { "NOT NULL" };
    let pk = if c.is_primary_key { " PK" } else { "" };
    format!("{}: {} {}{}", c.name, type_s, null, pk)
}

fn column_style(c: &ColumnDef) -> Style {
    if c.is_primary_key {
        Style::new().fg(Color::Yellow)
    } else {
        Style::new().fg(Color::White)
    }
}

fn clamp_selection(flat: &[FlatLine], list_state: &mut ListState) {
    if flat.is_empty() {
        list_state.select(None);
    } else {
        let sel = list_state.selected().unwrap_or(0).min(flat.len() - 1);
        list_state.select(Some(sel));
    }
}

fn handle_key(
    key: KeyEvent,
    tree: &mut [TableNode],
    flat: &[FlatLine],
    list_state: &mut ListState,
) -> bool {
    let len = flat.len();
    let sel = list_state.selected().unwrap_or(0);

    match key.code {
        KeyCode::Char('q') | KeyCode::Esc => return true,
        KeyCode::Up | KeyCode::Char('k') if sel > 0 => list_state.select(Some(sel - 1)),
        KeyCode::Down | KeyCode::Char('j') if sel + 1 < len => list_state.select(Some(sel + 1)),
        KeyCode::Enter | KeyCode::Char(' ') => {
            if let Some(line) = flat.get(sel) {
                if let Some(NodeRef::Table(i)) = line.node {
                    tree[i].expanded = !tree[i].expanded;
                }
            }
        }
        KeyCode::Right => {
            if let Some(NodeRef::Table(i)) = flat.get(sel).and_then(|l| l.node) {
                tree[i].expanded = true;
            }
        }
        KeyCode::Left => {
            if let Some(NodeRef::Table(i)) = flat.get(sel).and_then(|l| l.node) {
                tree[i].expanded = false;
            }
        }
        KeyCode::Char('a') => {
            for n in tree.iter_mut() {
                n.expanded = true;
            }
        }
        KeyCode::Char('z') => {
            for n in tree.iter_mut() {
                n.expanded = false;
            }
        }
        _ => {}
    }
    false
}

fn draw(f: &mut Frame, title: &str, flat: &[FlatLine], list_state: &mut ListState) {
    let chunks = Layout::vertical([
        Constraint::Length(3),
        Constraint::Min(3),
        Constraint::Length(2),
    ])
    .split(f.area());

    f.render_widget(
        Paragraph::new(title).block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::new().fg(Color::Cyan))
                .title(" multiSectorBD "),
        ),
        chunks[0],
    );

    let items: Vec<ListItem> = flat
        .iter()
        .map(|line| {
            let indent = "  ".repeat(line.depth);
            let marker = if line.has_children {
                if line.expanded { "▼ " } else { "▶ " }
            } else {
                "  "
            };
            ListItem::new(Line::from(vec![
                Span::styled(format!("{indent}{marker}"), Style::new().fg(Color::DarkGray)),
                Span::styled(line.label.clone(), line.style),
            ]))
        })
        .collect();

    let list = List::new(items)
        .block(Block::default().borders(Borders::ALL).title(" Таблицы и колонки "))
        .highlight_style(Style::new().bg(Color::DarkGray).add_modifier(Modifier::BOLD))
        .highlight_symbol("▸ ");

    f.render_stateful_widget(list, chunks[1], list_state);

    f.render_widget(
        Paragraph::new("↑↓ — навигация | Space/Enter — таблица | a — все | z — свернуть | q — далее")
            .style(Style::new().fg(Color::DarkGray)),
        chunks[2],
    );
}
