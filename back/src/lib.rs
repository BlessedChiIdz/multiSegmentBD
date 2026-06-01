mod cli;
mod config;
mod db;
mod query;
mod schema;
mod server;
mod state;

pub use cli::Cli;
pub use config::{ConfigFile, Segment};
pub use schema::{DatabaseSchema, TableDef};
pub use state::AppState;

pub use query::{
    check_config, execute_query, load_config, load_schema, validate_config_path, QueryOptions,
};

use anyhow::Result;
use server::SharedState;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

pub async fn run_server(cli: Cli) -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "multiSectorBD=info,tower_http=info".into()),
        )
        .init();

    let mut state = AppState {
        config_path: cli.config.clone(),
        connect_timeout_secs: cli.connect_timeout_secs,
        max_concurrent_segments: cli.max_concurrent_segments.max(1),
        schema: DatabaseSchema::default(),
        schema_source: String::new(),
    };

    let config = check_config(&state).await?;
    info!(
        config = %state.config_path.display(),
        segments = config.segments.len(),
        "конфиг загружен"
    );

    let (schema, source) = load_schema(&state, &config).await?;
    info!(
        source = %source,
        tables = schema.tables.len(),
        "схема загружена"
    );
    state.schema = schema;
    state.schema_source = source;

    let shared: SharedState = Arc::new(RwLock::new(state));
    let app = server::router(shared);

    let addr = format!("{}:{}", cli.host, cli.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    info!(%addr, "HTTP сервер запущен");

    axum::serve(listener, app).await?;
    Ok(())
}
