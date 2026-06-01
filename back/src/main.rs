use clap::Parser;
use multiSectorBD::Cli;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    multiSectorBD::run_server(Cli::parse()).await
}
