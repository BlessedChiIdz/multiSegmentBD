mod app;
mod cli;
mod config;
mod db;
mod query;
mod schema;
mod state;
mod tui;

pub use cli::Cli;
pub use config::{ConfigFile, Segment};
pub use schema::{DatabaseSchema, TableDef};
pub use state::AppState;
pub use tui::CrudMode;

pub use query::{
    check_config, execute_query, load_config, load_schema, validate_config_path, QueryOptions,
};

use anyhow::Result;

pub async fn run_interactive(cli: Cli) -> Result<()> {
    let mut state = AppState {
        config_path: cli.config.clone(),
        connect_timeout_secs: cli.connect_timeout_secs,
        max_concurrent_segments: cli.max_concurrent_segments.max(1),
        schema: DatabaseSchema::default(),
        schema_source: String::new(),
    };
    let config = check_config(&state).await?;
    println!(
        "Конфиг OK: {} ({} сегментов)",
        state.config_path.display(),
        config.segments.len()
    );

    println!("Загрузка схемы БД (эталонный сегмент)...");
    let (schema, source) = load_schema(&state, &config).await?;
    println!(
        "Схема загружена из «{source}»: {} таблиц в public",
        schema.tables.len()
    );
    tui::schema::browse(&schema, &source)?;

    state = AppState::from_cli(cli, schema, source);
    app::run(state).await
}
