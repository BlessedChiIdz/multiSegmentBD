use anyhow::{Context, Result};
use postgres_types::Type;
use serde_json::{json, Value};
use tokio_postgres::Row;
use uuid::Uuid;

pub fn row_to_values(row: &Row) -> Result<Vec<Value>> {
    let mut out = Vec::with_capacity(row.len());
    for i in 0..row.len() {
        out.push(cell_as_json(row, i)?);
    }
    Ok(out)
}

fn cell_as_json(row: &Row, idx: usize) -> Result<Value> {
    let col = row.columns().get(idx).context("индекс колонки")?;
    let ty = col.type_();

    let v = match ty {
        t if t == &Type::BOOL => match row.get::<_, Option<bool>>(idx) {
            None => Value::Null,
            Some(b) => json!(b),
        },
        t if t == &Type::INT2 => match row.get::<_, Option<i16>>(idx) {
            None => Value::Null,
            Some(x) => json!(x),
        },
        t if t == &Type::INT4 => match row.get::<_, Option<i32>>(idx) {
            None => Value::Null,
            Some(x) => json!(x),
        },
        t if t == &Type::INT8 => match row.get::<_, Option<i64>>(idx) {
            None => Value::Null,
            Some(x) => json!(x),
        },
        t if t == &Type::FLOAT4 => match row.get::<_, Option<f32>>(idx) {
            None => Value::Null,
            Some(x) => json!(x),
        },
        t if t == &Type::FLOAT8 => match row.get::<_, Option<f64>>(idx) {
            None => Value::Null,
            Some(x) => json!(x),
        },
        t if t == &Type::TEXT || t == &Type::VARCHAR || t == &Type::BPCHAR => {
            match row.get::<_, Option<String>>(idx) {
                None => Value::Null,
                Some(s) => Value::String(s),
            }
        }
        t if t == &Type::JSON || t == &Type::JSONB => row
            .get::<_, Option<serde_json::Value>>(idx)
            .unwrap_or(Value::Null),
        t if t == &Type::TIMESTAMP => match row.get::<_, Option<chrono::NaiveDateTime>>(idx) {
            None => Value::Null,
            Some(dt) => json!(dt.to_string()),
        },
        t if t == &Type::TIMESTAMPTZ => match row.get::<_, Option<chrono::DateTime<chrono::Utc>>>(idx) {
            None => Value::Null,
            Some(dt) => json!(dt.to_rfc3339()),
        },
        t if t == &Type::BYTEA => match row.get::<_, Option<Vec<u8>>>(idx) {
            None => Value::Null,
            Some(bytes) => json!(format!("<bytea {} bytes>", bytes.len())),
        },
        t if t == &Type::UUID => match row.get::<_, Option<Uuid>>(idx) {
            None => Value::Null,
            Some(uuid) => Value::String(uuid.to_string()),
        },
        _ => json!(format!("<unsupported postgres type: {}>", ty.name())),
    };
    Ok(v)
}
