use crate::config::{load, validate_path, ConfigFile, Segment};
use crate::db::runner;
use crate::schema::{fetch_schema, DatabaseSchema};
use crate::state::AppState;
use anyhow::{bail, Context, Result};
use futures::stream::{FuturesUnordered, StreamExt};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Semaphore;
use tokio::time::{timeout, Duration};

#[derive(Debug, Clone, Copy, Default)]
pub struct QueryOptions {
    /// Остановить обход сегментов после первого сегмента с хотя бы одной строкой результата.
    pub stop_on_first_match: bool,
}

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

pub async fn execute_query(
    state: &AppState,
    sql: String,
    filter: &[String],
    options: QueryOptions,
) -> Result<Vec<Value>> {
    let sql = sql.trim().to_string();
    if sql.is_empty() {
        bail!("Пустой SQL");
    }

    let raw = load(&state.config_path)?;
    let segments = filter_segments(raw.segments, filter)?;
    Ok(
        run_on_all_segments(
            segments,
            sql,
            state.connect_timeout(),
            state.max_concurrent_segments,
            options,
        )
        .await,
    )
}

fn segment_has_rows(value: &Value) -> bool {
    if value.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return false;
    }
    if value.get("row_count").and_then(|v| v.as_u64()).is_some_and(|n| n > 0) {
        return true;
    }
    value
        .get("rows")
        .and_then(|r| r.as_array())
        .is_some_and(|rows| !rows.is_empty())
}

async fn run_on_all_segments(
    segments: Vec<Segment>,
    sql: String,
    connect_timeout: Duration,
    max_concurrent: usize,
    options: QueryOptions,
) -> Vec<Value> {
    let semaphore = Arc::new(Semaphore::new(max_concurrent.max(1)));
    let stop_on_first_match = options.stop_on_first_match;
    let found = Arc::new(AtomicBool::new(false));

    let mut tasks = FuturesUnordered::new();
    for seg in segments {
        let q = sql.clone();
        let seg_name = seg.name.clone();
        let ct = connect_timeout;
        let sem = Arc::clone(&semaphore);
        let found = Arc::clone(&found);
        tasks.push(async move {
            if stop_on_first_match && found.load(Ordering::Acquire) {
                return None;
            }

            let _permit = sem
                .acquire()
                .await
                .expect("семафор сегментов не закрыт");

            if stop_on_first_match && found.load(Ordering::Acquire) {
                return None;
            }

            let value = match timeout(ct, runner::run_on_segment(seg, q)).await {
                Ok(v) => v,
                Err(_) => json!({
                    "segment": seg_name,
                    "ok": false,
                    "error": format!("таймаут {} с (подключение или запрос)", ct.as_secs()),
                }),
            };

            if stop_on_first_match && segment_has_rows(&value) {
                found.store(true, Ordering::Release);
            }

            Some(value)
        });
    }

    let mut out: Vec<Value> = Vec::new();
    while let Some(item) = tasks.next().await {
        let Some(value) = item else { continue };
        let stop_now = stop_on_first_match && segment_has_rows(&value);
        out.push(value);
        if stop_now {
            found.store(true, Ordering::Release);
            break;
        }
    }

    out.sort_by(|a, b| {
        let sa = a.get("segment").and_then(|x| x.as_str()).unwrap_or("");
        let sb = b.get("segment").and_then(|x| x.as_str()).unwrap_or("");
        sa.cmp(sb)
    });

    out
}
