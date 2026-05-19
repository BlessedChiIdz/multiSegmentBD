use clap::Parser;
use multiSectorBD::Cli;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    multiSectorBD::run_interactive(Cli::parse()).await
}
