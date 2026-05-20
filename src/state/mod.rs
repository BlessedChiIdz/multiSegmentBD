use crate::cli::Cli;
use crate::schema::DatabaseSchema;
use std::path::PathBuf;
use std::time::Duration;

pub struct AppState {
    pub config_path: PathBuf,
    pub connect_timeout_secs: u64,
    pub max_concurrent_segments: usize,
    pub schema: DatabaseSchema,
    pub schema_source: String,
}

impl AppState {
    pub fn from_cli(cli: Cli, schema: DatabaseSchema, schema_source: String) -> Self {
        Self {
            config_path: cli.config,
            connect_timeout_secs: cli.connect_timeout_secs,
            max_concurrent_segments: cli.max_concurrent_segments.max(1),
            schema,
            schema_source,
        }
    }

    pub fn connect_timeout(&self) -> Duration {
        Duration::from_secs(self.connect_timeout_secs.max(1))
    }
}
