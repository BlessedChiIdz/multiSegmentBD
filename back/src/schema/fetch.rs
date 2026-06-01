use crate::config::Segment;
use crate::db::runner;
use crate::schema::types::{parse_schema_rows, DatabaseSchema};
use anyhow::{bail, Result};
use std::time::Duration;
use tokio::time::timeout;

pub const SCHEMA_QUERY: &str = include_str!("query.sql");

pub async fn fetch_schema(segment: &Segment, connect_timeout: Duration) -> Result<DatabaseSchema> {
    let seg = segment.clone();
    let sql = SCHEMA_QUERY.to_string();
    let result = timeout(connect_timeout, runner::run_on_segment(seg, sql))
        .await
        .map_err(|_| anyhow::anyhow!("таймаут загрузки схемы"))?;

    if result.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        let err = result
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("неизвестная ошибка");
        bail!("{err}");
    }

    let columns: Vec<String> = result
        .get("columns")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    let rows = result
        .get("rows")
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();

    parse_schema_rows(&columns, &rows)
}
