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
    pub fn connect_timeout(&self) -> Duration {
        Duration::from_secs(self.connect_timeout_secs.max(1))
    }
}
