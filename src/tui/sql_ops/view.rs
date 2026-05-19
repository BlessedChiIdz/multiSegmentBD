use crate::schema::{ColumnDef, DatabaseSchema, TableDef};
use crate::tui::util::{poll_keys, TerminalGuard};
use anyhow::{bail, Context, Result};
use crossterm::event::{KeyCode, KeyEvent, KeyEventKind};
use dialoguer::{Input, theme::ColorfulTheme};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style, Stylize};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, ListState, Paragraph};
use ratatui::Frame;
use std::collections::HashSet;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CrudMode {
    Select,
    Insert,
    Update,
    Delete,
}

impl CrudMode {
    fn title(self) -> &'static str {
        match self {
            Self::Select => "SELECT",
            Self::Insert => "INSERT",
            Self::Update => "UPDATE",
            Self::Delete => "DELETE",
        }
    }

    fn color(self) -> Color {
        match self {
            Self::Select => Color::Cyan,
            Self::Insert => Color::Green,
            Self::Update => Color::Yellow,
            Self::Delete => Color::Red,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Panel {
    Tables,
    Details,
}

pub struct SqlBuildResult {
    pub sql: String,
}

pub fn run(schema: &DatabaseSchema, mode: CrudMode) -> Result<Option<SqlBuildResult>> {
    if schema.tables.is_empty() {
        bail!("схема пуста");
    }

    let mut table_state = ListState::default();
    table_state.select(Some(0));
    let mut detail_state = ListState::default();
    detail_state.select(Some(0));

    let mut table_idx = 0usize;
    let mut selected_cols: HashSet<usize> = HashSet::new();
    let mut col_values: Vec<String> = Vec::new();
    let mut update_col: usize = 0;
    let mut where_clause = String::new();
    let mut focus = Panel::Tables;

    reset_for_table(schema, mode, 0, &mut selected_cols, &mut col_values, &mut update_col);

    let mut guard = TerminalGuard::enter()?;

    loop {
        let table = &schema.tables[table_idx];
        sync_detail_state(table, &mut detail_state, mode, update_col);

        guard.terminal_mut().draw(|f| {
            draw(
                f,
                mode,
                focus,
                schema,
                table_idx,
                table,
                &mut table_state,
                &mut detail_state,
                &selected_cols,
                &col_values,
                update_col,
                &where_clause,
            );
        })?;

        for key in poll_keys(50)? {
            if key.kind != KeyEventKind::Press {
                continue;
            }
            match handle_key(
                key,
                mode,
                schema,
                &mut focus,
                &mut table_idx,
                &mut table_state,
                &mut detail_state,
                &mut selected_cols,
                &mut col_values,
                &mut update_col,
                &mut where_clause,
            )? {
                KeyAction::Continue => {}
                KeyAction::Quit => return Ok(None),
                KeyAction::Run => {
                    let sql = build_sql(
                        mode,
                        table,
                        &selected_cols,
                        &col_values,
                        update_col,
                        &where_clause,
                    )?;
                    return Ok(Some(SqlBuildResult { sql }));
                }
            }
        }
    }
}

enum KeyAction {
    Continue,
    Quit,
    Run,
}

fn reset_for_table(
    schema: &DatabaseSchema,
    mode: CrudMode,
    table_idx: usize,
    selected_cols: &mut HashSet<usize>,
    col_values: &mut Vec<String>,
    update_col: &mut usize,
) {
    let table = &schema.tables[table_idx];
    selected_cols.clear();
    match mode {
        CrudMode::Select => {
            for i in 0..table.columns.len() {
                selected_cols.insert(i);
            }
        }
        CrudMode::Insert | CrudMode::Update => {
            *col_values = table.columns.iter().map(|_| String::new()).collect();
            *update_col = 0;
        }
        CrudMode::Delete => {}
    }
}

fn sync_detail_state(
    table: &TableDef,
    detail_state: &mut ListState,
    mode: CrudMode,
    update_col: usize,
) {
    if table.columns.is_empty() {
        detail_state.select(None);
        return;
    }
    let idx = match mode {
        CrudMode::Update => update_col.min(table.columns.len() - 1),
        _ => detail_state.selected().unwrap_or(0).min(table.columns.len() - 1),
    };
    detail_state.select(Some(idx));
}

fn handle_key(
    key: KeyEvent,
    mode: CrudMode,
    schema: &DatabaseSchema,
    focus: &mut Panel,
    table_idx: &mut usize,
    table_state: &mut ListState,
    detail_state: &mut ListState,
    selected_cols: &mut HashSet<usize>,
    col_values: &mut Vec<String>,
    update_col: &mut usize,
    where_clause: &mut String,
) -> Result<KeyAction> {
    let tables_len = schema.tables.len();
    let table = &schema.tables[*table_idx];
    let cols_len = table.columns.len();

    match key.code {
        KeyCode::Char('q') | KeyCode::Esc => return Ok(KeyAction::Quit),
        KeyCode::Tab => *focus = toggle_panel(*focus),
        KeyCode::Char('r') => return Ok(KeyAction::Run),
        KeyCode::Char('w') => {
            *where_clause = prompt_line("WHERE (без слова WHERE, пусто = нет)")?;
            return Ok(KeyAction::Continue);
        }
        KeyCode::Char('e') if matches!(mode, CrudMode::Insert | CrudMode::Update) => {
            let ci = detail_state.selected().unwrap_or(0);
            if ci < col_values.len() {
                let col = &table.columns[ci];
                let hint = if col.is_nullable {
                    "пусто = NULL"
                } else {
                    "обязательно"
                };
                col_values[ci] =
                    prompt_line(&format!("Значение для {} ({hint})", col.name))?;
                if mode == CrudMode::Update {
                    *update_col = ci;
                }
            }
            return Ok(KeyAction::Continue);
        }
        KeyCode::Char(' ') if *focus == Panel::Details && mode == CrudMode::Select => {
            if let Some(ci) = detail_state.selected() {
                if selected_cols.contains(&ci) {
                    selected_cols.remove(&ci);
                } else {
                    selected_cols.insert(ci);
                }
            }
            return Ok(KeyAction::Continue);
        }
        KeyCode::Up | KeyCode::Char('k') => match *focus {
            Panel::Tables if *table_idx > 0 => {
                *table_idx -= 1;
                table_state.select(Some(*table_idx));
                reset_for_table(
                    schema,
                    mode,
                    *table_idx,
                    selected_cols,
                    col_values,
                    update_col,
                );
            }
            Panel::Details if cols_len > 0 => {
                let s = detail_state.selected().unwrap_or(0);
                if s > 0 {
                    detail_state.select(Some(s - 1));
                }
            }
            _ => {}
        },
        KeyCode::Down | KeyCode::Char('j') => match *focus {
            Panel::Tables if *table_idx + 1 < tables_len => {
                *table_idx += 1;
                table_state.select(Some(*table_idx));
                reset_for_table(
                    schema,
                    mode,
                    *table_idx,
                    selected_cols,
                    col_values,
                    update_col,
                );
            }
            Panel::Details if cols_len > 0 => {
                let s = detail_state.selected().unwrap_or(0);
                if s + 1 < cols_len {
                    detail_state.select(Some(s + 1));
                }
            }
            _ => {}
        },
        _ => {}
    }
    Ok(KeyAction::Continue)
}

fn toggle_panel(p: Panel) -> Panel {
    match p {
        Panel::Tables => Panel::Details,
        Panel::Details => Panel::Tables,
    }
}

fn prompt_line(prompt: &str) -> Result<String> {
    let theme = ColorfulTheme::default();
    let s: String = Input::with_theme(&theme).with_prompt(prompt).interact_text()?;
    Ok(s.trim().to_string())
}

fn build_sql(
    mode: CrudMode,
    table: &TableDef,
    selected_cols: &HashSet<usize>,
    col_values: &[String],
    update_col: usize,
    where_clause: &str,
) -> Result<String> {
    let where_sql = format_where(where_clause);

    match mode {
        CrudMode::Select => {
            let cols: Vec<&str> = if selected_cols.is_empty() {
                bail!("выберите хотя бы одну колонку");
            } else {
                let mut v: Vec<_> = selected_cols
                    .iter()
                    .filter_map(|&i| table.columns.get(i).map(|c| c.name.as_str()))
                    .collect();
                v.sort();
                v
            };
            Ok(format!(
                "SELECT {} FROM {} {}",
                cols.join(", "),
                quote_ident(&table.name),
                where_sql
            )
            .trim()
            .to_string())
        }
        CrudMode::Insert => {
            let mut names = Vec::new();
            let mut vals = Vec::new();
            for (i, col) in table.columns.iter().enumerate() {
                let raw = col_values.get(i).map(String::as_str).unwrap_or("");
                if raw.is_empty() {
                    if col.is_nullable {
                        continue;
                    }
                    bail!("колонка {} обязательна для INSERT", col.name);
                }
                names.push(quote_ident(&col.name));
                vals.push(literal_sql(raw, col));
            }
            if names.is_empty() {
                bail!("укажите значения для INSERT");
            }
            Ok(format!(
                "INSERT INTO {} ({}) VALUES ({})",
                quote_ident(&table.name),
                names.join(", "),
                vals.join(", ")
            ))
        }
        CrudMode::Update => {
            let col = table
                .columns
                .get(update_col)
                .context("колонка для UPDATE")?;
            let raw = col_values.get(update_col).map(String::as_str).unwrap_or("");
            if raw.is_empty() && col.is_nullable {
                Ok(format!(
                    "UPDATE {} SET {} = NULL {}",
                    quote_ident(&table.name),
                    quote_ident(&col.name),
                    where_sql
                )
                .trim()
                .to_string())
            } else if raw.is_empty() {
                bail!("укажите новое значение для {}", col.name);
            } else {
                Ok(format!(
                    "UPDATE {} SET {} = {} {}",
                    quote_ident(&table.name),
                    quote_ident(&col.name),
                    literal_sql(raw, col),
                    where_sql
                )
                .trim()
                .to_string())
            }
        }
        CrudMode::Delete => Ok(format!(
            "DELETE FROM {} {}",
            quote_ident(&table.name),
            where_sql
        )
        .trim()
        .to_string()),
    }
}

fn format_where(where_clause: &str) -> String {
    let w = where_clause.trim();
    if w.is_empty() {
        String::new()
    } else {
        format!("WHERE {w}")
    }
}

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn literal_sql(raw: &str, col: &ColumnDef) -> String {
    let numeric = matches!(
        col.data_type.as_str(),
        "smallint"
            | "integer"
            | "bigint"
            | "numeric"
            | "real"
            | "double precision"
            | "decimal"
    );
    if numeric {
        raw.to_string()
    } else if raw.eq_ignore_ascii_case("null") {
        "NULL".to_string()
    } else {
        format!("'{}'", raw.replace('\'', "''"))
    }
}

fn draw(
    f: &mut Frame,
    mode: CrudMode,
    focus: Panel,
    schema: &DatabaseSchema,
    table_idx: usize,
    table: &TableDef,
    table_state: &mut ListState,
    detail_state: &mut ListState,
    selected_cols: &HashSet<usize>,
    col_values: &[String],
    update_col: usize,
    where_clause: &str,
) {
    let chunks = Layout::vertical([
        Constraint::Length(3),
        Constraint::Min(5),
        Constraint::Length(3),
    ])
    .split(f.area());

    let header = Paragraph::new(format!(
        "Таблица: {} | WHERE: {}",
        table.name,
        if where_clause.is_empty() {
            "(нет)".into()
        } else {
            where_clause.to_string()
        }
    ))
    .block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::new().fg(mode.color()))
            .title(format!(" {} ", mode.title())),
    );
    f.render_widget(header, chunks[0]);

    let cols = Layout::horizontal([Constraint::Percentage(35), Constraint::Percentage(65)])
        .split(chunks[1]);

    draw_tables(
        f,
        cols[0],
        &schema.tables,
        table_idx,
        table_state,
        focus == Panel::Tables,
    );
    draw_details(
        f,
        cols[1],
        mode,
        table,
        detail_state,
        selected_cols,
        col_values,
        update_col,
        focus == Panel::Details,
    );

    let help = match mode {
        CrudMode::Select => "Tab — панели | Space — колонка | w — WHERE | r — выполнить | q — назад",
        CrudMode::Insert => "Tab — панели | e — значение | r — выполнить | q — назад",
        CrudMode::Update => "Tab — панели | e — SET | w — WHERE | r — выполнить | q — назад",
        CrudMode::Delete => "Tab — таблицы | w — WHERE | r — выполнить | q — назад",
    };
    f.render_widget(
        Paragraph::new(help).style(Style::new().fg(Color::DarkGray)),
        chunks[2],
    );
}

fn draw_tables(
    f: &mut Frame,
    area: Rect,
    tables: &[TableDef],
    current: usize,
    state: &mut ListState,
    focused: bool,
) {
    let border = if focused {
        Style::new().fg(Color::Yellow)
    } else {
        Style::new().fg(Color::DarkGray)
    };
    let items: Vec<ListItem> = tables
        .iter()
        .enumerate()
        .map(|(i, t)| {
            let style = if i == current {
                Style::new().fg(Color::Green).bold()
            } else {
                Style::new().fg(Color::White)
            };
            ListItem::new(Span::styled(&t.name, style))
        })
        .collect();
    let list = List::new(items)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(border)
                .title(" Таблицы "),
        )
        .highlight_style(Style::new().bg(Color::DarkGray).add_modifier(Modifier::BOLD))
        .highlight_symbol("▸ ");
    f.render_stateful_widget(list, area, state);
}

fn draw_details(
    f: &mut Frame,
    area: Rect,
    mode: CrudMode,
    table: &TableDef,
    detail_state: &mut ListState,
    selected_cols: &HashSet<usize>,
    col_values: &[String],
    update_col: usize,
    focused: bool,
) {
    let border = if focused {
        Style::new().fg(Color::Yellow)
    } else {
        Style::new().fg(Color::DarkGray)
    };

    let items: Vec<ListItem> = table
        .columns
        .iter()
        .enumerate()
        .map(|(i, col)| {
            let label = match mode {
                CrudMode::Select => {
                    let mark = if selected_cols.contains(&i) { "[x]" } else { "[ ]" };
                    format!("{mark} {}", format_column_short(col))
                }
                CrudMode::Insert => {
                    let v = col_values.get(i).map(String::as_str).unwrap_or("");
                    let disp = if v.is_empty() { "∅" } else { v };
                    format!("{} = {disp}", col.name)
                }
                CrudMode::Update => {
                    let v = col_values.get(i).map(String::as_str).unwrap_or("");
                    let disp = if v.is_empty() { "∅" } else { v };
                    let mark = if i == update_col { ">>" } else { "  " };
                    format!("{mark} {} = {disp}", col.name)
                }
                CrudMode::Delete => format_column_short(col),
            };
            let style = if col.is_primary_key {
                Style::new().fg(Color::Yellow)
            } else {
                Style::new().fg(Color::White)
            };
            ListItem::new(Line::from(Span::styled(label, style)))
        })
        .collect();

    let title = match mode {
        CrudMode::Select => " Колонки ",
        CrudMode::Insert => " Значения INSERT ",
        CrudMode::Update => " SET ",
        CrudMode::Delete => " Колонки (справка) ",
    };

    let list = List::new(items)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(border)
                .title(title),
        )
        .highlight_style(Style::new().bg(Color::DarkGray).add_modifier(Modifier::BOLD))
        .highlight_symbol("▸ ");

    f.render_stateful_widget(list, area, detail_state);
}

fn format_column_short(c: &ColumnDef) -> String {
    let pk = if c.is_primary_key { " PK" } else { "" };
    format!("{} ({}){}", c.name, c.data_type, pk)
}
