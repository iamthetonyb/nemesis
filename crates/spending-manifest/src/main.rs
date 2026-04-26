use std::{
    env, fs, io,
    path::{Path, PathBuf},
    process,
};

use serde::Serialize;
use sha2::{Digest, Sha256};

const DEFAULT_ROOT: &str = "frontend";
const DEFAULT_OUTPUT: &str = "frontend/data/manifest.json";
const VERSION: u8 = 1;

fn main() {
    let mut root = PathBuf::from(DEFAULT_ROOT);
    let mut output = PathBuf::from(DEFAULT_OUTPUT);

    let mut args = env::args_os().skip(1);
    while let Some(arg) = args.next() {
        match arg.to_string_lossy().as_ref() {
            "--root" => {
                let Some(value) = args.next() else {
                    fail("--root requires a path");
                };
                root = PathBuf::from(value);
            }
            "--output" => {
                let Some(value) = args.next() else {
                    fail("--output requires a path");
                };
                output = PathBuf::from(value);
            }
            "--help" | "-h" => {
                println!(
                    "usage: spending-manifest [--root frontend] [--output frontend/data/manifest.json]"
                );
                return;
            }
            other => fail(&format!("unknown argument `{other}`")),
        }
    }

    if let Err(error) = write_manifest(&root, &output) {
        eprintln!("manifest generation failed: {error}");
        process::exit(1);
    }
}

#[derive(Serialize)]
struct Manifest {
    schema_version: u8,
    algorithm: &'static str,
    root: String,
    files: Vec<Entry>,
}

#[derive(Serialize)]
struct Entry {
    path: String,
    bytes: u64,
    sha256: String,
}

fn write_manifest(root: &Path, output: &Path) -> Result<(), String> {
    let entries = build_entries(root, output)?;
    let manifest = Manifest {
        schema_version: VERSION,
        algorithm: "sha256",
        root: normalize_path(root),
        files: entries,
    };

    let raw = serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())?;
    let mut with_newline = raw;
    with_newline.push('\n');

    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "could not create output directory {}: {error}",
                parent.display()
            )
        })?;
    }
    fs::write(output, with_newline)
        .map_err(|error| format!("could not write {}: {error}", output.display()))
}

fn build_entries(root: &Path, output: &Path) -> Result<Vec<Entry>, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("could not resolve root {}: {error}", root.display()))?;
    let output = match (output.parent(), output.file_name()) {
        (Some(parent), Some(file_name)) => parent
            .canonicalize()
            .map_or_else(|_| output.to_path_buf(), |parent| parent.join(file_name)),
        _ => output.to_path_buf(),
    };

    let mut files = Vec::new();
    collect_files(&root, &root, &output, &mut files)
        .map_err(|error| format!("could not walk {}: {error}", root.display()))?;
    files.sort();

    files
        .into_iter()
        .map(|path| entry_for(&root, &path))
        .collect()
}

fn collect_files(
    root: &Path,
    current: &Path,
    output: &Path,
    files: &mut Vec<PathBuf>,
) -> io::Result<()> {
    for item in fs::read_dir(current)? {
        let item = item?;
        let path = item.path();
        if path.is_dir() {
            collect_files(root, &path, output, files)?;
            continue;
        }
        if !path.is_file() || path == output {
            continue;
        }
        if is_public_file(root, &path) {
            files.push(path);
        }
    }
    Ok(())
}

fn is_public_file(root: &Path, path: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    let path = normalize_path(relative);
    path == "index.html"
        || path == "robots.txt"
        || path == "_headers"
        || path.starts_with("data/")
        || path.starts_with("assets/css/")
        || path.starts_with("assets/js/")
        || path.starts_with("assets/media/")
}

fn entry_for(root: &Path, path: &Path) -> Result<Entry, String> {
    let bytes =
        fs::read(path).map_err(|error| format!("could not read {}: {error}", path.display()))?;
    let relative = path
        .strip_prefix(root)
        .map_err(|error| format!("could not relativize {}: {error}", path.display()))?;
    let digest = Sha256::digest(&bytes);
    Ok(Entry {
        path: normalize_path(relative),
        bytes: u64::try_from(bytes.len()).map_err(|error| error.to_string())?,
        sha256: hex::encode(digest),
    })
}

fn normalize_path(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    process::exit(2);
}
