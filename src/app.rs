use crate::{execute_query, load_config, results_view, validate_config_path, AppState};
use anyhow::{bail, Context, Result};
use dialoguer::{theme::ColorfulTheme, Input, MultiSelect, Select};
use std::path::PathBuf;

pub async fn run(mut state: AppState) -> Result<()> {
    let theme = ColorfulTheme::default();
    
    loop {
        println!();
        println!("=== multiSectorBD ===");
        println!("Конфиг: {}", state.config_path.display());
        println!("Таймаут: {} с", state.connect_timeout_secs);

        let items = [
            "Выполнить SQL на всех сегментах",
            "Выполнить SQL на выбранных сегментах",
            "Список сегментов из конфига",
            "Настройки",
            "Выход",
        ];

        let choice = Select::with_theme(&theme)
            .with_prompt("Главное меню")
            .items(&items)
            .default(0)
            .interact()?;

        match choice {
            0 => run_query(&state, &[], &theme).await?,
            1 => {
                let filter = pick_segments(&state, &theme)?;
                if filter.is_empty() {
                    println!("Сегменты не выбраны.");
                    pause(&theme)?;
                    continue;
                }
                run_query(&state, &filter, &theme).await?;
            }
            2 => {
                if let Err(e) = list_segments(&state) {
                    eprintln!("\nОшибка: {e:#}");
                }
                pause(&theme)?;
            }
            3 => settings_menu(&mut state, &theme)?,
            4 => {
                println!("До свидания.");
                break;
            }
            _ => unreachable!(),
        }
    }

    Ok(())
}

async fn run_query(state: &AppState, filter: &[String], theme: &ColorfulTheme) -> Result<()> {
    let sql = match read_sql(theme)? {
        Some(s) => s,
        None => return Ok(()),
    };

    println!("\nВыполняется запрос...");
    match execute_query(state, sql, filter).await {
        Ok(results) => {
            if let Err(e) = results_view::browse(&results) {
                eprintln!("\nОшибка просмотра результатов: {e:#}");
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

fn settings_menu(state: &mut AppState, theme: &ColorfulTheme) -> Result<()> {
    loop {
        let items = [
            "Путь к segments.json",
            "Таймаут подключения (сек)",
            "Назад в главное меню",
        ];

        let choice = Select::with_theme(theme)
            .with_prompt("Настройки")
            .items(&items)
            .default(2)
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
            2 => break,
            _ => unreachable!(),
        }
    }
    Ok(())
}
