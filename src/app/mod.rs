use crate::query::{execute_query, load_config, load_schema, validate_config_path};
use crate::state::AppState;
use crate::tui::{self, CrudMode};
use anyhow::{bail, Context, Result};
use dialoguer::{theme::ColorfulTheme, Confirm, Input, MultiSelect, Select};
use std::path::PathBuf;
use clap::builder::Str;

pub async fn run(mut state: AppState) -> Result<()> {
    let theme = ColorfulTheme::default();

    loop {
        println!();
        println!("=== multiSectorBD ===");
        println!("Конфиг: {}", state.config_path.display());
        println!(
            "Схема: {} таблиц (эталон: {}) | Таймаут: {} с",
            state.schema.tables.len(),
            state.schema_source,
            state.connect_timeout_secs
        );

        let items = [
            "SELECT — визуальный конструктор",
            "INSERT — визуальный конструктор",
            "UPDATE — визуальный конструктор",
            "DELETE — визуальный конструктор",
            "Произвольный SQL",
            "Схема БД (просмотр)",
            "Список сегментов",
            "Настройки",
            "Выход",
        ];

        let choice = Select::with_theme(&theme)
            .with_prompt("Главное меню")
            .items(&items)
            .default(0)
            .interact()?;

        match choice {
            0 => run_crud(&state, CrudMode::Select, &theme).await?,
            1 => run_crud(&state, CrudMode::Insert, &theme).await?,
            2 => run_crud(&state, CrudMode::Update, &theme).await?,
            3 => run_crud(&state, CrudMode::Delete, &theme).await?,
            4 => run_free_sql(&state, &theme).await?,
            5 => tui::schema::browse(&state.schema, &state.schema_source)?,
            6 => {
                if let Err(e) = list_segments(&state) {
                    eprintln!("\nОшибка: {e:#}");
                }
                pause(&theme)?;
            }
            7 => settings_menu(&mut state, &theme).await?,
            8 => {
                println!("До свидания.");
                break;
            }
            _ => unreachable!(),
        }
    }

    Ok(())
}

async fn run_crud(state: &AppState, mode: CrudMode, theme: &ColorfulTheme) -> Result<()> {
    let built = match tui::sql_ops::run(&state.schema, mode)? {
        Some(b) => b,
        None => return Ok(()),
    };

    println!("\nСформированный SQL:\n{}\n", built.sql);
    let sql_for_browse: String = built.sql.clone();

    let filter = pick_segment_filter(state, theme)?;
    println!("\nВыполняется запрос...");
    match execute_query(state, built.sql, &filter).await {
        Ok(results) => {
            if let Err(e) = tui::results::browse(&results, sql_for_browse) {
                eprintln!("\nОшибка просмотра: {e:#}");
                pause(theme)?;
            }
        }
        Err(e) => {
            eprintln!("\nОшибка: {e:#}");
            pause(theme)?;
        }
    }
    Ok(())
}

async fn run_free_sql(state: &AppState, theme: &ColorfulTheme) -> Result<()> {
    let sql = match read_sql(theme)? {
        Some(s) => s,
        None => return Ok(()),
    };

    let items = ["Все сегменты", "Выбранные сегменты"];
    let scope = Select::with_theme(theme)
        .with_prompt("Где выполнить?")
        .items(&items)
        .default(0)
        .interact()?;

    let filter = match scope {
        0 => Vec::new(),
        1 => pick_segments(state, theme)?,
        _ => unreachable!(),
    };

    if scope == 1 && filter.is_empty() {
        println!("Сегменты не выбраны.");
        pause(theme)?;
        return Ok(());
    }

    let sql_for_browse: String = sql.clone();

    println!("\nВыполняется запрос...");
    match execute_query(state, sql, &filter).await {
        Ok(results) => {
            if let Err(e) = tui::results::browse(&results, sql_for_browse) {
                eprintln!("\nОшибка просмотра: {e:#}");
                pause(theme)?;
            }
        }
        Err(e) => {
            eprintln!("\nОшибка: {e:#}");
            pause(theme)?;
        }
    }
    Ok(())
}

fn pick_segment_filter(state: &AppState, theme: &ColorfulTheme) -> Result<Vec<String>> {
    let items = ["Все сегменты", "Выбранные сегменты"];
    let scope = Select::with_theme(theme)
        .with_prompt("Где выполнить?")
        .items(&items)
        .default(0)
        .interact()?;
    match scope {
        0 => Ok(Vec::new()),
        1 => pick_segments(state, theme),
        _ => unreachable!(),
    }
}

fn read_sql(theme: &ColorfulTheme) -> Result<Option<String>> {
    let items = ["Ввести одной строкой", "Загрузить из файла", "Отмена"];

    let choice = Select::with_theme(theme)
        .with_prompt("Как задать SQL?")
        .items(&items)
        .default(0)
        .interact()?;

    let sql = match choice {
        0 => Input::with_theme(theme)
            .with_prompt("SQL")
            .interact_text()?,
        1 => {
            let path: String = Input::with_theme(theme)
                .with_prompt("Путь к .sql файлу")
                .interact_text()?;
            std::fs::read_to_string(&path).with_context(|| format!("чтение {path}"))?
        }
        2 => return Ok(None),
        _ => unreachable!(),
    };

    Ok(Some(sql))
}

fn pause(theme: &ColorfulTheme) -> Result<()> {
    let _: String = Input::with_theme(theme)
        .with_prompt("Enter — вернуться в меню")
        .allow_empty(true)
        .interact_text()?;
    Ok(())
}

fn list_segments(state: &AppState) -> Result<()> {
    let raw = load_config(&state.config_path)?;
    println!("\nСегменты ({}):", raw.segments.len());
    println!(
        "{:<20} {:<22} {:>5}  {}",
        "NAME", "HOST", "PORT", "DATABASE"
    );
    println!("{}", "-".repeat(70));
    for s in &raw.segments {
        println!(
            "{:<20} {:<22} {:>5}  {}",
            s.name, s.host, s.port, s.database
        );
    }
    Ok(())
}

fn pick_segments(state: &AppState, theme: &ColorfulTheme) -> Result<Vec<String>> {
    let raw = load_config(&state.config_path)?;
    if raw.segments.is_empty() {
        bail!("В конфиге нет сегментов");
    }

    let labels: Vec<String> = raw
        .segments
        .iter()
        .map(|s| format!("{} — {}:{}/{}", s.name, s.host, s.port, s.database))
        .collect();

    let picked = MultiSelect::with_theme(theme)
        .with_prompt("Выберите сегменты (пробел — задействовать сегмент, Enter — далее)")
        .items(&labels)
        .interact()?;

    Ok(picked
        .into_iter()
        .map(|i| raw.segments[i].name.clone())
        .collect())
}

async fn settings_menu(state: &mut AppState, theme: &ColorfulTheme) -> Result<()> {
    loop {
        let items = [
            "Путь к segments.json",
            "Таймаут подключения (сек)",
            "Перезагрузить схему БД",
            "Назад в главное меню",
        ];

        let choice = Select::with_theme(theme)
            .with_prompt("Настройки")
            .items(&items)
            .default(3)
            .interact()?;

        match choice {
            0 => {
                let path: String = Input::with_theme(theme)
                    .with_prompt("Файл конфигурации")
                    .default(state.config_path.display().to_string())
                    .interact_text()?;
                let path = PathBuf::from(path.trim());
                validate_config_path(&path)?;
                state.config_path = path;
                println!("Конфиг обновлён и проверен.");
            }
            1 => {
                let secs: String = Input::with_theme(theme)
                    .with_prompt("Таймаут (сек)")
                    .default(state.connect_timeout_secs.to_string())
                    .interact_text()?;
                state.connect_timeout_secs = secs
                    .trim()
                    .parse()
                    .context("таймаут должен быть числом")?;
            }
            2 => reload_schema(state).await?,
            3 => break,
            _ => unreachable!(),
        }
    }
    Ok(())
}

async fn reload_schema(state: &mut AppState) -> Result<()> {
    let config = load_config(&state.config_path)?;
    println!("Загрузка схемы...");
    let (schema, source) = load_schema(state, &config).await?;
    state.schema = schema;
    state.schema_source = source;
    println!(
        "Схема обновлена: {} таблиц (эталон: {})",
        state.schema.tables.len(),
        state.schema_source
    );
    if Confirm::with_theme(&ColorfulTheme::default())
        .with_prompt("Открыть просмотр схемы?")
        .default(true)
        .interact()?
    {
        tui::schema::browse(&state.schema, &state.schema_source)?;
    }
    Ok(())
}
