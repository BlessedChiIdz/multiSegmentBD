use clap::Parser;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(about = "Многосегментный PostgreSQL — HTTP API (Axum)")]
pub struct Cli {
    #[arg(short, long, default_value = "segments.json")]
    pub config: PathBuf,

    #[arg(long, default_value_t = 30, value_name = "SECS")]
    pub connect_timeout_secs: u64,

    /// Сколько сегментов одновременно подключать при выполнении SQL.
    #[arg(long, default_value_t = 10, value_name = "N")]
    pub max_concurrent_segments: usize,

    #[arg(long, default_value = "127.0.0.1")]
    pub host: String,

    #[arg(short, long, default_value_t = 8080)]
    pub port: u16,
}
