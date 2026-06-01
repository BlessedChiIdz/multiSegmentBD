use crate::query::{execute_query, load_config, load_schema, QueryOptions};
use crate::server::SharedState;
use crate::state::AppState;
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
}

#[derive(Serialize)]
pub struct StatusResponse {
    pub config_path: String,
    pub connect_timeout_secs: u64,
    pub max_concurrent_segments: usize,
    pub schema_source: String,
    pub table_count: usize,
}

#[derive(Serialize)]
pub struct SegmentInfo {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
}

#[derive(Serialize)]
pub struct SegmentsResponse {
    pub segments: Vec<SegmentInfo>,
}

#[derive(Serialize)]
pub struct SchemaResponse {
    pub source: String,
    pub schema: crate::schema::DatabaseSchema,
}

#[derive(Deserialize)]
pub struct QueryRequest {
    pub sql: String,
    #[serde(default)]
    pub segments: Vec<String>,
    #[serde(default)]
    pub stop_on_first_match: bool,
}

#[derive(Serialize)]
pub struct QueryResponse {
    pub results: Vec<Value>,
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

pub(crate) struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad_request(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: msg.into(),
        }
    }

    fn internal(err: impl std::fmt::Display) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: err.to_string(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorBody {
                error: self.message,
            }),
        )
            .into_response()
    }
}

pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

pub async fn status(State(state): State<SharedState>) -> Json<StatusResponse> {
    let s = state.read().await;
    Json(StatusResponse {
        config_path: s.config_path.display().to_string(),
        connect_timeout_secs: s.connect_timeout_secs,
        max_concurrent_segments: s.max_concurrent_segments,
        schema_source: s.schema_source.clone(),
        table_count: s.schema.tables.len(),
    })
}

pub async fn list_segments(State(state): State<SharedState>) -> Result<Json<SegmentsResponse>, ApiError> {
    let s = state.read().await;
    let config = load_config(&s.config_path).map_err(ApiError::internal)?;
    let segments = config
        .segments
        .into_iter()
        .map(|seg| SegmentInfo {
            name: seg.name,
            host: seg.host,
            port: seg.port,
            database: seg.database,
            user: seg.user,
        })
        .collect();
    Ok(Json(SegmentsResponse { segments }))
}

pub async fn get_schema(State(state): State<SharedState>) -> Json<SchemaResponse> {
    let s = state.read().await;
    Json(SchemaResponse {
        source: s.schema_source.clone(),
        schema: s.schema.clone(),
    })
}

pub async fn reload_schema(State(state): State<SharedState>) -> Result<Json<SchemaResponse>, ApiError> {
    let mut s = state.write().await;
    reload_schema_inner(&mut s).await?;
    Ok(Json(SchemaResponse {
        source: s.schema_source.clone(),
        schema: s.schema.clone(),
    }))
}

async fn reload_schema_inner(state: &mut AppState) -> Result<(), ApiError> {
    let config = load_config(&state.config_path).map_err(ApiError::internal)?;
    let (schema, source) = load_schema(state, &config)
        .await
        .map_err(ApiError::internal)?;
    state.schema = schema;
    state.schema_source = source;
    Ok(())
}

pub async fn post_query(
    State(state): State<SharedState>,
    Json(body): Json<QueryRequest>,
) -> Result<Json<QueryResponse>, ApiError> {
    let s = state.read().await;
    let results = execute_query(
        &s,
        body.sql,
        &body.segments,
        QueryOptions {
            stop_on_first_match: body.stop_on_first_match,
        },
    )
    .await
    .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    Ok(Json(QueryResponse { results }))
}
