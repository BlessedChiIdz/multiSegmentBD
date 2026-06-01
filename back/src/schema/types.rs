use anyhow::{bail, Context, Result};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize)]
pub struct ColumnDef {
    pub name: String,
    pub data_type: String,
    pub char_max_len: Option<i64>,
    pub is_nullable: bool,
    pub is_primary_key: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TableDef {
    pub name: String,
    pub columns: Vec<ColumnDef>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct DatabaseSchema {
    pub tables: Vec<TableDef>,
}

impl DatabaseSchema {
    pub fn table(&self, name: &str) -> Option<&TableDef> {
        self.tables.iter().find(|t| t.name == name)
    }

    pub fn table_at(&self, idx: usize) -> Option<&TableDef> {
        self.tables.get(idx)
    }
}

pub fn parse_schema_rows(columns: &[String], rows: &[Value]) -> Result<DatabaseSchema> {
    let idx = |name: &str| -> Result<usize> {
        columns
            .iter()
            .position(|c| c == name)
            .with_context(|| format!("в ответе нет колонки {name}"))
    };

    let i_table = idx("table_name")?;
    let i_col = idx("column_name")?;
    let i_type = idx("data_type")?;
    let i_len = idx("character_maximum_length")?;
    let i_null = idx("is_nullable")?;
    let i_pk = idx("is_primary_key")?;

    let mut map: BTreeMap<String, Vec<ColumnDef>> = BTreeMap::new();

    for row in rows {
        let cells = row
            .as_array()
            .context("строка схемы должна быть массивом")?;

        let table_name = cell_str(cells, i_table)?;
        let col = ColumnDef {
            name: cell_str(cells, i_col)?,
            data_type: cell_str(cells, i_type)?,
            char_max_len: cell_opt_i64(cells, i_len),
            is_nullable: cell_str(cells, i_null)? == "YES",
            is_primary_key: cell_str(cells, i_pk)? == "YES",
        };
        map.entry(table_name).or_default().push(col);
    }

    let tables: Vec<TableDef> = map
        .into_iter()
        .map(|(name, columns)| TableDef { name, columns })
        .collect();

    if tables.is_empty() {
        bail!("схема public не содержит таблиц");
    }

    Ok(DatabaseSchema { tables })
}

fn cell_str(row: &[Value], idx: usize) -> Result<String> {
    match row.get(idx) {
        Some(Value::String(s)) => Ok(s.clone()),
        Some(Value::Null) => bail!("неожиданный NULL в схеме"),
        Some(other) => Ok(other.to_string().trim_matches('"').to_string()),
        None => bail!("короткая строка в ответе схемы"),
    }
}

fn cell_opt_i64(row: &[Value], idx: usize) -> Option<i64> {
    match row.get(idx)? {
        Value::Null => None,
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}
