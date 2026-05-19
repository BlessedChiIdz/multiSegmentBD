use clap::Parser;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(about = "Многосегментный PostgreSQL — интерактивный терминал")]
pub struct Cli {
    #[arg(short, long, default_value = "segments.json")]
    pub config: PathBuf,

    #[arg(long, default_value_t = 30, value_name = "SECS")]
    pub connect_timeout_secs: u64,
}
