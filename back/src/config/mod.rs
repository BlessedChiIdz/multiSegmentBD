use anyhow::{bail, Context, Result};
use serde::Deserialize;
use std::collections::HashSet;
use std::path::Path;

#[derive(Debug, Deserialize)]
pub struct ConfigFile {
    pub segments: Vec<Segment>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Segment {
    pub name: String,
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub database: String,
    pub user: String,
    pub password: Option<String>,
    pub password_env: Option<String>,
}

fn default_port() -> u16 {
    5432
}

impl ConfigFile {
    pub fn validate(&self) -> Result<()> {
        if self.segments.is_empty() {
            bail!("в конфиге должен быть хотя бы один сегмент");
        }

        let mut names = HashSet::new();

        for seg in &self.segments {
            let name = seg.name.trim();
            if name.is_empty() {
                bail!("у сегмента задано пустое имя (name)");
            }
            if !names.insert(name.to_string()) {
                bail!("дублирующееся имя сегмента: {name}");
            }

            if seg.host.trim().is_empty() {
                bail!("сегмент {name}: пустой host");
            }
            if seg.database.trim().is_empty() {
                bail!("сегмент {name}: пустой database");
            }
            if seg.user.trim().is_empty() {
                bail!("сегмент {name}: пустой user");
            }
            if seg.port == 0 {
                bail!("сегмент {name}: port не может быть 0");
            }

            match (&seg.password, &seg.password_env) {
                (None, None) => {
                    bail!("сегмент {name}: укажите password или password_env");
                }
                (Some(_), Some(_)) => {
                    bail!(
                        "сегмент {name}: заданы и password, и password_env — оставьте один вариант"
                    );
                }
                (None, Some(key)) => {
                    std::env::var(key).with_context(|| {
                        format!("сегмент {name}: переменная окружения {key} не задана")
                    })?;
                }
                (Some(_), None) => {}
            }
        }

        Ok(())
    }
}

impl Segment {
    pub fn password(&self) -> Result<String> {
        if let Some(p) = &self.password {
            return Ok(p.clone());
        }
        if let Some(key) = &self.password_env {
            return std::env::var(key).with_context(|| format!("переменная окружения {key} не задана"));
        }
        bail!(
            "сегмент {}: укажите password или password_env",
            self.name
        );
    }
}

pub fn load(path: &Path) -> Result<ConfigFile> {
    let text = std::fs::read_to_string(path).with_context(|| format!("чтение {}", path.display()))?;
    serde_json::from_str(&text).context("разбор JSON конфигурации")
}

pub fn validate_path(path: &Path) -> Result<ConfigFile> {
    if !path.exists() {
        bail!("файл конфигурации не найден: {}", path.display());
    }
    if !path.is_file() {
        bail!("путь конфигурации не является файлом: {}", path.display());
    }
    let config = load(path)?;
    config.validate().context("конфигурация невалидна")?;
    Ok(config)
}
