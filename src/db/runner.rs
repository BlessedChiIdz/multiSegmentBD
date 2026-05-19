use crate::config::Segment;
use crate::db::row_json;
use anyhow::Context;
use serde_json::{json, Value};
use tokio_postgres::NoTls;

pub async fn run_on_segment(seg: Segment, sql: String) -> Value {
    let seg_label = seg.name.clone();
    let name_for_log = seg.name.clone();

    let res: Result<Value, anyhow::Error> = async move {
        let mut cfg = tokio_postgres::Config::new();
        cfg.host(&seg.host);
        cfg.port(seg.port);
        cfg.dbname(&seg.database);
        cfg.user(&seg.user);
        cfg.password(&seg.password()?);

        let (client, connection) = cfg.connect(NoTls).await.context("connect")?;
        tokio::spawn(async move {
            if let Err(e) = connection.await {
                eprintln!("{name_for_log}: фоновое соединение: {e}");
            }
        });

        let trimmed = sql.trim_start();
        let is_query = (trimmed.len() >= 6
            && trimmed.as_bytes()[..6].eq_ignore_ascii_case(b"SELECT"))
            || (trimmed.len() >= 4 && trimmed.as_bytes()[..4].eq_ignore_ascii_case(b"WITH"));

        if is_query {
            let rows = client.query(&sql, &[]).await.context("query")?;
            let columns: Vec<String> = if let Some(r) = rows.first() {
                r.columns().iter().map(|c| c.name().to_string()).collect()
            } else {
                Vec::new()
            };

            let mut data = Vec::with_capacity(rows.len());
            for r in &rows {
                data.push(row_json::row_to_values(r).context("row_to_values")?);
            }

            Ok(json!({
                "segment": seg.name,
                "ok": true,
                "columns": columns,
                "row_count": rows.len(),
                "rows_affected": Value::Null,
                "rows": data,
            }))
        } else {
            let affected = client.execute(&sql, &[]).await.context("execute")?;
            Ok(json!({
                "segment": seg.name,
                "ok": true,
                "columns": ["rows_affected"],
                "row_count": 0,
                "rows_affected": affected,
                "rows": [[affected]],
            }))
        }
    }
    .await;

    match res {
        Ok(v) => v,
        Err(e) => json!({
            "segment": seg_label,
            "ok": false,
            "error": format!("{e:#}"),
        }),
    }
}
