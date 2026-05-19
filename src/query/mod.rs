use crate::config::{load, validate_path, ConfigFile, Segment};
use crate::db::runner;
use crate::schema::{fetch_schema, DatabaseSchema};
use crate::state::AppState;
use anyhow::{bail, Context, Result};
use futures::stream::{FuturesUnordered, StreamExt};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::Path;
use tokio::time::{timeout, Duration};

pub fn load_config(path: &Path) -> Result<ConfigFile> {
    load(path)
}

pub fn validate_config_path(path: &Path) -> Result<ConfigFile> {
    validate_path(path)
}

pub async fn check_config(state: &AppState) -> Result<ConfigFile> {
    validate_path(&state.config_path)
}

pub async fn load_schema(state: &AppState, config: &ConfigFile) -> Result<(DatabaseSchema, String)> {
    let seg = config
        .segments
        .first()
        .context("в конфиге нет сегментов для загрузки схемы")?;
    let name = seg.name.clone();
    let schema = fetch_schema(seg, state.connect_timeout()).await?;
    Ok((schema, name))
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

    let raw = load(&state.config_path)?;
    let segments = filter_segments(raw.segments, filter)?;
    Ok(run_on_all_segments(segments, sql, state.connect_timeout()).await)
}

async fn run_on_all_segments(
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
