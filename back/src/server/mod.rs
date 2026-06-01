mod handlers;

use crate::state::AppState;
use axum::{
    routing::{get, post},
    Router,
};
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

pub type SharedState = Arc<RwLock<AppState>>;

pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/health", get(handlers::health))
        .route("/api/status", get(handlers::status))
        .route("/api/segments", get(handlers::list_segments))
        .route("/api/schema", get(handlers::get_schema))
        .route("/api/schema/reload", post(handlers::reload_schema))
        .route("/api/query", post(handlers::post_query))
        .with_state(state)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
}
