use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use thiserror::Error;

pub const DEFAULT_PORT: u16 = 8080;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ServeCliOptions {
    pub config_file: Option<PathBuf>,
    pub routes: Option<PathBuf>,
    pub collections: Option<PathBuf>,
    pub port: Option<u16>,
    pub collection: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServeConfig {
    pub routes: PathBuf,
    pub collections: PathBuf,
    pub port: u16,
    pub collection: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeConfigFile {
    #[serde(alias = "routesDir")]
    routes: Option<PathBuf>,
    #[serde(alias = "collectionsFile")]
    collections: Option<PathBuf>,
    port: Option<u16>,
    #[serde(alias = "startupCollection")]
    collection: Option<String>,
}

impl ServeConfig {
    pub fn from_options(options: ServeCliOptions, cwd: &Path) -> Result<Self, ConfigError> {
        let (file_config, config_base) = match &options.config_file {
            Some(path) => {
                let path = absolutize(cwd, path);
                (
                    Some(read_config_file(&path)?),
                    path.parent().unwrap_or(cwd).to_path_buf(),
                )
            }
            None => (None, cwd.to_path_buf()),
        };

        let routes = resolve_required_path(
            cwd,
            &config_base,
            options.routes,
            file_config
                .as_ref()
                .and_then(|config| config.routes.clone()),
            "routes",
        )?;
        let collections = resolve_required_path(
            cwd,
            &config_base,
            options.collections,
            file_config
                .as_ref()
                .and_then(|config| config.collections.clone()),
            "collections",
        )?;
        let port = options
            .port
            .or_else(|| file_config.as_ref().and_then(|config| config.port))
            .unwrap_or(DEFAULT_PORT);
        let collection = options.collection.or_else(|| {
            file_config
                .as_ref()
                .and_then(|config| config.collection.clone())
        });

        Ok(Self {
            routes,
            collections,
            port,
            collection,
        })
    }
}

fn read_config_file(path: &Path) -> Result<NativeConfigFile, ConfigError> {
    let input = fs::read_to_string(path).map_err(|source| ConfigError::ReadConfig {
        path: path.to_path_buf(),
        source,
    })?;
    serde_yaml::from_str(&input).map_err(|source| ConfigError::ParseConfig {
        path: path.to_path_buf(),
        source,
    })
}

fn resolve_required_path(
    cwd: &Path,
    config_base: &Path,
    cli_value: Option<PathBuf>,
    config_value: Option<PathBuf>,
    name: &'static str,
) -> Result<PathBuf, ConfigError> {
    if let Some(path) = cli_value {
        return Ok(absolutize(cwd, &path));
    }

    if let Some(path) = config_value {
        return Ok(absolutize(config_base, &path));
    }

    Err(ConfigError::MissingValue { name })
}

fn absolutize(base: &Path, path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        base.join(path)
    }
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("failed to read config `{}`: {source}", path.display())]
    ReadConfig {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("failed to parse config `{}`: {source}", path.display())]
    ParseConfig {
        path: PathBuf,
        source: serde_yaml::Error,
    },
    #[error("missing required serve {name}; pass --{name} or set it in --config")]
    MissingValue { name: &'static str },
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn config_file_supplies_serve_inputs_relative_to_config_file() {
        let dir = tempdir().unwrap();
        let base = dir.path();
        fs::create_dir_all(base.join("nested")).unwrap();
        fs::write(
            base.join("nested/decoy.yaml"),
            r#"
routes: config/routes
collections: config/collections.yaml
port: 4100
startupCollection: local
"#,
        )
        .unwrap();

        let config = ServeConfig::from_options(
            ServeCliOptions {
                config_file: Some(base.join("nested/decoy.yaml")),
                ..ServeCliOptions::default()
            },
            base,
        )
        .unwrap();

        assert_eq!(config.routes, base.join("nested/config/routes"));
        assert_eq!(
            config.collections,
            base.join("nested/config/collections.yaml")
        );
        assert_eq!(config.port, 4100);
        assert_eq!(config.collection.as_deref(), Some("local"));
    }

    #[test]
    fn config_file_accepts_descriptive_path_aliases() {
        let dir = tempdir().unwrap();
        let base = dir.path();
        fs::write(
            base.join("decoy.yaml"),
            r#"
routesDir: config/routes
collectionsFile: config/collections.yaml
"#,
        )
        .unwrap();

        let config = ServeConfig::from_options(
            ServeCliOptions {
                config_file: Some(base.join("decoy.yaml")),
                ..ServeCliOptions::default()
            },
            base,
        )
        .unwrap();

        assert_eq!(config.routes, base.join("config/routes"));
        assert_eq!(config.collections, base.join("config/collections.yaml"));
    }

    #[test]
    fn explicit_cli_flags_override_config_values() {
        let dir = tempdir().unwrap();
        let base = dir.path();
        fs::write(
            base.join("decoy.yaml"),
            r#"
routes: config/routes
collections: config/collections.yaml
port: 4100
collection: config-collection
"#,
        )
        .unwrap();

        let config = ServeConfig::from_options(
            ServeCliOptions {
                config_file: Some(base.join("decoy.yaml")),
                routes: Some(PathBuf::from("flag/routes")),
                collections: Some(PathBuf::from("flag/collections.yaml")),
                port: Some(4200),
                collection: Some("flag-collection".to_owned()),
            },
            base,
        )
        .unwrap();

        assert_eq!(config.routes, base.join("flag/routes"));
        assert_eq!(config.collections, base.join("flag/collections.yaml"));
        assert_eq!(config.port, 4200);
        assert_eq!(config.collection.as_deref(), Some("flag-collection"));
    }

    #[test]
    fn missing_required_paths_fail_before_startup() {
        let dir = tempdir().unwrap();
        let error = ServeConfig::from_options(ServeCliOptions::default(), dir.path()).unwrap_err();

        assert_eq!(
            error.to_string(),
            "missing required serve routes; pass --routes or set it in --config"
        );
    }
}
