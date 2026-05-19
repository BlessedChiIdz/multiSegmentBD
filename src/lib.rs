mod app;
mod cli;
mod config;
mod results_view;
mod row_json;
mod runner;

pub use cli::Cli;
pub use config::{ConfigFile, Segment};

use anyhow::{bail, Context, Result};
use futures::stream::{FuturesUnordered, StreamExt};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tokio::time::{timeout, Duration};

pub struct AppState {
    pub config_path: PathBuf,
    pub connect_timeout_secs: u64,
}

impl AppState {
    pub fn from_cli(cli: Cli) -> Self {
        Self {
            config_path: cli.config,
            connect_timeout_secs: cli.connect_timeout_secs,
        }
    }

    pub fn connect_timeout(&self) -> Duration {
        Duration::from_secs(self.connect_timeout_secs.max(1))
    }
}

pub fn load_config(path: &Path) -> Result<ConfigFile> {
    let text =
        std::fs::read_to_string(path).with_context(|| format!("чтение {}", path.display()))?;
    serde_json::from_str(&text).context("разбор JSON конфигурации")
}

/// Загрузка и проверка конфига по пути из `state`.
pub async fn check_config(state: &AppState) -> Result<ConfigFile> {
    validate_config_path(&state.config_path)
}

pub fn validate_config_path(path: &Path) -> Result<ConfigFile> {
    if !path.exists() {
        bail!("файл конфигурации не найден: {}", path.display());
    }
    if !path.is_file() {
        bail!("путь конфигурации не является файлом: {}", path.display());
    }

    let config = load_config(path)?;
    config.validate().context("конфигурация невалидна")?;
    Ok(config)
}

pub fn filter_segments(mut segments: Vec<Segment>, filter: &[String]) -> Result<Vec<Segment>> {
    if filter.is_empty() {
        return Ok(segments);
    }
    let want: HashSet<_> = filter.iter().cloned().collect();
    segments.retain(|s| want.contains(&s.name));
    if segments.is_empty() {
        bail!("После фильтрации не осталось ни одного сегмента");
    }
    Ok(segments)
}

pub async fn execute_query(state: &AppState, sql: String, filter: &[String]) -> Result<Vec<Value>> {
    let sql = sql.trim().to_string();
    if sql.is_empty() {
        bail!("Пустой SQL");
    }

    let raw = load_config(&state.config_path)?;
    let segments = filter_segments(raw.segments, filter)?;
    Ok(query_all_segments(segments, sql, state.connect_timeout()).await)
}

pub async fn run_interactive(cli: Cli) -> Result<()> {
    let state = AppState::from_cli(cli);
    let config = check_config(&state).await?;
    println!(
        "Конфиг OK: {} ({} сегментов)",
        state.config_path.display(),
        config.segments.len()
    );
    app::run(state).await
}

async fn query_all_segments(
    segments: Vec<Segment>,
    sql: String,
    connect_timeout: Duration,
) -> Vec<Value> {
    let mut tasks = FuturesUnordered::new();
    for seg in segments {
        let q = sql.clone();
        let seg_name = seg.name.clone();
        let ct = connect_timeout;
        tasks.push(async move {
            match timeout(ct, runner::run_on_segment(seg, q)).await {
                Ok(v) => v,
                Err(_) => json!({
                    "segment": seg_name,
                    "ok": false,
                    "error": format!("таймаут {} с (подключение или запрос)", ct.as_secs()),
                }),
            }
        });
    }

    let mut out: Vec<Value> = Vec::new();
    while let Some(item) = tasks.next().await {
        out.push(item);
    }

    out.sort_by(|a, b| {
        let sa = a.get("segment").and_then(|x| x.as_str()).unwrap_or("");
        let sb = b.get("segment").and_then(|x| x.as_str()).unwrap_or("");
        sa.cmp(sb)
    });

    out
}
