use std::{
    collections::{HashMap, HashSet},
    env, fs, io,
    path::{Path, PathBuf},
    process,
};

use serde_json::Value;
use sha2::{Digest, Sha256};

fn main() {
    let mut args = env::args_os().skip(1);
    let path = args.next().map_or_else(
        || PathBuf::from("frontend/data/bootstrap.json"),
        PathBuf::from,
    );
    let manifest = args.next().map(PathBuf::from);

    match validate_path(&path) {
        Ok(report) => {
            println!(
                "validated {}: {} regions, {} packages, {} sources",
                path.display(),
                report.regions,
                report.packages,
                report.sources
            );
        }
        Err(errors) => {
            eprintln!("validation failed for {}", path.display());
            for error in errors {
                eprintln!("- {error}");
            }
            process::exit(1);
        }
    }

    if let Some(manifest) = manifest {
        match validate_manifest(&manifest) {
            Ok(report) => println!(
                "verified {}: {} files, {} bytes",
                manifest.display(),
                report.files,
                report.bytes
            ),
            Err(errors) => {
                eprintln!("manifest validation failed for {}", manifest.display());
                for error in errors {
                    eprintln!("- {error}");
                }
                process::exit(1);
            }
        }
    }
}

#[derive(Debug)]
struct Report {
    regions: usize,
    packages: usize,
    sources: usize,
}

#[derive(Debug)]
struct ManifestReport {
    files: usize,
    bytes: u64,
}

fn validate_path(path: &PathBuf) -> Result<Report, Vec<String>> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) => return Err(vec![format!("could not read file: {error}")]),
    };

    let root: Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(error) => return Err(vec![format!("invalid JSON: {error}")]),
    };

    validate_root(&root)
}

fn validate_manifest(path: &Path) -> Result<ManifestReport, Vec<String>> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) => return Err(vec![format!("could not read manifest: {error}")]),
    };

    let manifest: Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(error) => return Err(vec![format!("invalid manifest JSON: {error}")]),
    };

    let root_dir = path
        .parent()
        .and_then(Path::parent)
        .unwrap_or_else(|| Path::new("frontend"));

    validate_manifest_root(&manifest, root_dir, path)
}

fn validate_manifest_root(
    manifest: &Value,
    root_dir: &Path,
    manifest_path: &Path,
) -> Result<ManifestReport, Vec<String>> {
    let mut errors = Vec::new();

    if manifest.get("schema_version").and_then(Value::as_u64) != Some(1) {
        errors.push("manifest.schema_version must be 1".to_string());
    }
    if manifest.get("algorithm").and_then(Value::as_str) != Some("sha256") {
        errors.push("manifest.algorithm must be sha256".to_string());
    }
    if manifest.get("root").and_then(Value::as_str) != Some("frontend") {
        errors.push("manifest.root must be frontend".to_string());
    }

    let Some(files) = manifest.get("files").and_then(Value::as_array) else {
        errors.push("manifest.files must be an array".to_string());
        return Err(errors);
    };

    if files.is_empty() {
        errors.push("manifest.files must not be empty".to_string());
    }

    let expected_files = match public_files(root_dir, manifest_path) {
        Ok(files) => files,
        Err(error) => {
            errors.push(format!("could not list public files: {error}"));
            HashMap::new()
        }
    };

    let mut seen = HashSet::new();
    let mut total_bytes = 0_u64;
    let mut previous_path: Option<String> = None;

    for (index, entry) in files.iter().enumerate() {
        let prefix = format!("manifest.files[{index}]");
        let path_value = required_string(entry, "path", &prefix, &mut errors);
        let sha_value = required_string(entry, "sha256", &prefix, &mut errors);
        let declared_bytes = entry.get("bytes").and_then(Value::as_u64);

        let Some(path_value) = path_value else {
            continue;
        };

        if !is_safe_manifest_path(path_value) {
            errors.push(format!("{prefix}.path is not a safe public relative path"));
            continue;
        }
        if let Some(previous) = previous_path.as_ref()
            && previous.as_str() >= path_value
        {
            errors.push(format!("{prefix}.path must be sorted ascending"));
        }
        previous_path = Some(path_value.to_string());

        if !seen.insert(path_value.to_string()) {
            errors.push(format!("{prefix}.path is duplicated: {path_value}"));
        }

        let Some(actual) = expected_files.get(path_value) else {
            errors.push(format!("{prefix}.path is not a generated public file"));
            continue;
        };

        if declared_bytes != Some(actual.bytes) {
            errors.push(format!(
                "{prefix}.bytes must equal actual file size ({})",
                actual.bytes
            ));
        }
        if let Some(sha_value) = sha_value {
            if sha_value.len() != 64 || !sha_value.chars().all(|char| char.is_ascii_hexdigit()) {
                errors.push(format!("{prefix}.sha256 must be a 64-character hex digest"));
            } else if !sha_value.eq_ignore_ascii_case(&actual.sha256) {
                errors.push(format!("{prefix}.sha256 does not match file hash"));
            }
        }
        total_bytes = total_bytes.saturating_add(actual.bytes);
    }

    for path in expected_files.keys() {
        if !seen.contains(path) {
            errors.push(format!("manifest.files is missing public file `{path}`"));
        }
    }

    if errors.is_empty() {
        Ok(ManifestReport {
            files: seen.len(),
            bytes: total_bytes,
        })
    } else {
        Err(errors)
    }
}

fn validate_root(root: &Value) -> Result<Report, Vec<String>> {
    let mut errors = Vec::new();

    let Some(object) = root.as_object() else {
        return Err(vec!["root must be a JSON object".to_string()]);
    };

    for key in [
        "sourceMeta",
        "summary",
        "legend",
        "geo",
        "regions",
        "provinceView",
        "ownerLists",
        "packageSamples",
    ] {
        if !object.contains_key(key) {
            errors.push(format!("missing top-level key `{key}`"));
        }
    }

    let source_count = validate_sources(root, &mut errors);
    let region_report = validate_regions(root, &mut errors);
    let province_keys = validate_provinces(root, &mut errors);
    let package_count = validate_packages(root, &region_report.keys, &province_keys, &mut errors);
    validate_summary(root, package_count, &mut errors);
    validate_geo_collection(
        root.get("geo"),
        "geo",
        "regionKey",
        &region_report.keys,
        &mut errors,
    );
    validate_geo_collection(
        root.pointer("/provinceView/geo"),
        "provinceView.geo",
        "provinceKey",
        &province_keys,
        &mut errors,
    );

    if errors.is_empty() {
        Ok(Report {
            regions: region_report.count,
            packages: package_count,
            sources: source_count,
        })
    } else {
        Err(errors)
    }
}

struct FileDigest {
    bytes: u64,
    sha256: String,
}

fn public_files(root: &Path, manifest_path: &Path) -> io::Result<HashMap<String, FileDigest>> {
    let root = root.canonicalize()?;
    let manifest_path = manifest_path.canonicalize().ok();
    let mut files = HashMap::new();
    collect_public_files(&root, &root, manifest_path.as_deref(), &mut files)?;
    Ok(files)
}

fn collect_public_files(
    root: &Path,
    current: &Path,
    manifest_path: Option<&Path>,
    files: &mut HashMap<String, FileDigest>,
) -> io::Result<()> {
    for item in fs::read_dir(current)? {
        let item = item?;
        let path = item.path();
        if path.is_dir() {
            collect_public_files(root, &path, manifest_path, files)?;
            continue;
        }
        if !path.is_file() || manifest_path.is_some_and(|manifest| manifest == path) {
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .map_or_else(|_| normalize_path(&path), normalize_path);
        if !is_manifest_public_file(&relative) {
            continue;
        }
        let bytes = fs::read(&path)?;
        let digest = Sha256::digest(&bytes);
        files.insert(
            relative,
            FileDigest {
                bytes: u64::try_from(bytes.len()).unwrap_or(u64::MAX),
                sha256: format!("{digest:x}"),
            },
        );
    }
    Ok(())
}

fn is_manifest_public_file(path: &str) -> bool {
    path == "index.html"
        || path == "404.html"
        || path == "robots.txt"
        || path == "sitemap.xml"
        || path == "_headers"
        || path.starts_with(".well-known/")
        || path.starts_with("legal/")
        || path.starts_with("data/")
        || path.starts_with("assets/css/")
        || path.starts_with("assets/fonts/")
        || path.starts_with("assets/js/")
        || path.starts_with("assets/media/")
        || path.starts_with("assets/vendor/")
}

fn is_safe_manifest_path(path: &str) -> bool {
    !path.starts_with('/')
        && !path.contains('\\')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
        && is_manifest_public_file(path)
}

fn normalize_path(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn validate_sources(root: &Value, errors: &mut Vec<String>) -> usize {
    let Some(sources) = root
        .pointer("/sourceMeta/sources")
        .and_then(Value::as_array)
    else {
        errors.push("sourceMeta.sources must be an array".to_string());
        return 0;
    };

    let mut has_usaspending = false;
    let mut has_census = false;

    for (index, source) in sources.iter().enumerate() {
        let Some(source) = source.as_str() else {
            errors.push(format!("sourceMeta.sources[{index}] must be a string"));
            continue;
        };

        if !source.starts_with("https://") {
            errors.push(format!(
                "sourceMeta.sources[{index}] must use HTTPS: {source}"
            ));
        }
        has_usaspending |= has_official_host(source, "usaspending.gov");
        has_census |= has_official_host(source, "census.gov");
    }

    if !has_usaspending {
        errors.push("sourceMeta.sources must include USAspending".to_string());
    }
    if !has_census {
        errors.push("sourceMeta.sources must include Census/TIGER boundaries".to_string());
    }

    sources.len()
}

fn validate_packages(
    root: &Value,
    region_keys: &HashSet<String>,
    province_keys: &HashSet<String>,
    errors: &mut Vec<String>,
) -> usize {
    let Some(packages) = root.get("packageSamples").and_then(Value::as_array) else {
        errors.push("packageSamples must be an array".to_string());
        return 0;
    };

    if packages.is_empty() {
        errors.push("packageSamples must not be empty".to_string());
    }

    let mut ids = HashSet::new();
    for (index, package) in packages.iter().enumerate() {
        let prefix = format!("packageSamples[{index}]");

        let id = required_string(package, "id", &prefix, errors);
        if let Some(id) = id
            && !ids.insert(id.to_string())
        {
            errors.push(format!("{prefix}.id is duplicated: {id}"));
        }

        let source_id = required_string(package, "sourceId", &prefix, errors);
        if let Some(source_id) = source_id
            && !is_approved_source_id(source_id)
        {
            errors.push(format!(
                "{prefix}.sourceId is not an approved official source URL"
            ));
        }

        required_string(package, "packageName", &prefix, errors);
        required_string(package, "ownerName", &prefix, errors);
        non_negative_number(package, "budget", &prefix, errors);

        validate_key_array(
            package,
            "regionKeys",
            &prefix,
            region_keys,
            "region",
            errors,
        );
        validate_key_array(
            package,
            "provinceKeys",
            &prefix,
            province_keys,
            "province",
            errors,
        );
    }

    packages.len()
}

struct RegionReport {
    count: usize,
    keys: HashSet<String>,
}

fn validate_regions(root: &Value, errors: &mut Vec<String>) -> RegionReport {
    let Some(regions) = root.get("regions").and_then(Value::as_array) else {
        errors.push("regions must be an array".to_string());
        return RegionReport {
            count: 0,
            keys: HashSet::new(),
        };
    };

    if regions.is_empty() {
        errors.push("regions must not be empty".to_string());
    }

    let mut keys = HashSet::new();
    for (index, region) in regions.iter().enumerate() {
        let prefix = format!("regions[{index}]");
        let key = required_string(region, "regionKey", &prefix, errors);
        if let Some(key) = key
            && !keys.insert(key.to_string())
        {
            errors.push(format!("{prefix}.regionKey is duplicated: {key}"));
        }
        required_string(region, "regionName", &prefix, errors);
        required_string(region, "regionType", &prefix, errors);
        required_string(region, "provinceName", &prefix, errors);
        non_negative_number(region, "totalBudget", &prefix, errors);
        non_negative_number(region, "totalPotentialWaste", &prefix, errors);
    }

    RegionReport {
        count: regions.len(),
        keys,
    }
}

fn validate_provinces(root: &Value, errors: &mut Vec<String>) -> HashSet<String> {
    let Some(provinces) = root
        .pointer("/provinceView/provinces")
        .and_then(Value::as_array)
    else {
        errors.push("provinceView.provinces must be an array".to_string());
        return HashSet::new();
    };

    let mut keys = HashSet::new();
    for (index, province) in provinces.iter().enumerate() {
        let prefix = format!("provinceView.provinces[{index}]");
        let key = required_string(province, "provinceKey", &prefix, errors);
        if let Some(key) = key
            && !keys.insert(key.to_string())
        {
            errors.push(format!("{prefix}.provinceKey is duplicated: {key}"));
        }
    }

    keys
}

fn validate_summary(root: &Value, package_count: usize, errors: &mut Vec<String>) {
    let Some(summary) = root.get("summary") else {
        return;
    };

    non_negative_number(summary, "totalBudget", "summary", errors);
    non_negative_number(summary, "totalPotentialWaste", "summary", errors);

    let declared_packages = summary.get("totalPackages").and_then(Value::as_u64);
    if declared_packages != Some(package_count as u64) {
        errors.push(format!(
            "summary.totalPackages must equal packageSamples length ({package_count})"
        ));
    }
}

fn validate_geo_collection(
    geo: Option<&Value>,
    prefix: &str,
    area_key: &str,
    known_keys: &HashSet<String>,
    errors: &mut Vec<String>,
) {
    let Some(geo) = geo else {
        errors.push(format!("{prefix} must exist"));
        return;
    };

    if geo.get("type").and_then(Value::as_str) != Some("FeatureCollection") {
        errors.push(format!("{prefix}.type must be FeatureCollection"));
    }

    let features = geo.get("features").and_then(Value::as_array);
    if features.is_none_or(Vec::is_empty) {
        errors.push(format!("{prefix}.features must not be empty"));
        return;
    }

    if let Some(features) = features {
        for (index, feature) in features.iter().enumerate() {
            let feature_prefix = format!("{prefix}.features[{index}]");
            if feature.get("type").and_then(Value::as_str) != Some("Feature") {
                errors.push(format!("{feature_prefix}.type must be Feature"));
            }

            let geometry_type = feature
                .get("geometry")
                .and_then(|geometry| geometry.get("type"))
                .and_then(Value::as_str);
            if geometry_type.is_none() {
                errors.push(format!("{feature_prefix}.geometry.type must be a string"));
            }
            validate_geometry_coordinates(feature, &feature_prefix, errors);

            let Some(properties) = feature.get("properties") else {
                errors.push(format!("{feature_prefix}.properties must exist"));
                continue;
            };

            let Some(key) = properties.get(area_key).and_then(Value::as_str) else {
                errors.push(format!(
                    "{feature_prefix}.properties.{area_key} must be a string"
                ));
                continue;
            };

            if !known_keys.contains(key) {
                errors.push(format!(
                    "{feature_prefix}.properties.{area_key} references unknown key `{key}`"
                ));
            }
        }
    }
}

fn validate_key_array(
    object: &Value,
    key: &str,
    prefix: &str,
    known_keys: &HashSet<String>,
    label: &str,
    errors: &mut Vec<String>,
) {
    let sample_keys = object.get(key).and_then(Value::as_array);
    if sample_keys.is_none_or(Vec::is_empty) {
        errors.push(format!("{prefix}.{key} must not be empty"));
        return;
    }

    if let Some(sample_keys) = sample_keys {
        for (key_index, key_value) in sample_keys.iter().enumerate() {
            let Some(key_value) = key_value.as_str() else {
                errors.push(format!("{prefix}.{key}[{key_index}] must be a string"));
                continue;
            };

            if !known_keys.contains(key_value) {
                errors.push(format!(
                    "{prefix}.{key}[{key_index}] references unknown {label} `{key_value}`"
                ));
            }
        }
    }
}

fn validate_geometry_coordinates(feature: &Value, prefix: &str, errors: &mut Vec<String>) {
    let Some(geometry) = feature.get("geometry") else {
        errors.push(format!("{prefix}.geometry must exist"));
        return;
    };

    let Some(geometry_type) = geometry.get("type").and_then(Value::as_str) else {
        return;
    };

    let Some(coordinates) = geometry.get("coordinates") else {
        errors.push(format!("{prefix}.geometry.coordinates must exist"));
        return;
    };

    match geometry_type {
        "Point" => validate_position(
            coordinates,
            &format!("{prefix}.geometry.coordinates"),
            errors,
        ),
        "MultiPoint" => validate_positions(
            coordinates,
            &format!("{prefix}.geometry.coordinates"),
            1,
            false,
            errors,
        ),
        "LineString" => validate_positions(
            coordinates,
            &format!("{prefix}.geometry.coordinates"),
            2,
            false,
            errors,
        ),
        "MultiLineString" => validate_nested_positions(
            coordinates,
            &format!("{prefix}.geometry.coordinates"),
            1,
            2,
            false,
            errors,
        ),
        "Polygon" => validate_nested_positions(
            coordinates,
            &format!("{prefix}.geometry.coordinates"),
            1,
            4,
            true,
            errors,
        ),
        "MultiPolygon" => validate_multi_polygon(
            coordinates,
            &format!("{prefix}.geometry.coordinates"),
            errors,
        ),
        unsupported => errors.push(format!(
            "{prefix}.geometry.type `{unsupported}` is not supported by the dashboard map"
        )),
    }
}

fn validate_multi_polygon(coordinates: &Value, prefix: &str, errors: &mut Vec<String>) {
    let Some(polygons) = coordinates.as_array() else {
        errors.push(format!("{prefix} must be an array"));
        return;
    };

    if polygons.is_empty() {
        errors.push(format!("{prefix} must not be empty"));
        return;
    }

    for (index, polygon) in polygons.iter().enumerate() {
        validate_nested_positions(polygon, &format!("{prefix}[{index}]"), 1, 4, true, errors);
    }
}

fn validate_nested_positions(
    coordinates: &Value,
    prefix: &str,
    min_groups: usize,
    min_positions: usize,
    require_closed: bool,
    errors: &mut Vec<String>,
) {
    let Some(groups) = coordinates.as_array() else {
        errors.push(format!("{prefix} must be an array"));
        return;
    };

    if groups.len() < min_groups {
        errors.push(format!(
            "{prefix} must contain at least {min_groups} coordinate group(s)"
        ));
    }

    for (index, group) in groups.iter().enumerate() {
        validate_positions(
            group,
            &format!("{prefix}[{index}]"),
            min_positions,
            require_closed,
            errors,
        );
    }
}

fn validate_positions(
    coordinates: &Value,
    prefix: &str,
    min_positions: usize,
    require_closed: bool,
    errors: &mut Vec<String>,
) {
    let Some(positions) = coordinates.as_array() else {
        errors.push(format!("{prefix} must be an array"));
        return;
    };

    if positions.len() < min_positions {
        errors.push(format!(
            "{prefix} must contain at least {min_positions} positions"
        ));
    }

    for (index, position) in positions.iter().enumerate() {
        validate_position(position, &format!("{prefix}[{index}]"), errors);
    }

    if require_closed {
        let first = positions.first().and_then(position_pair);
        let last = positions.last().and_then(position_pair);
        if first.is_none() || last.is_none() || first != last {
            errors.push(format!("{prefix} must be a closed linear ring"));
        }
    }
}

fn validate_position(coordinates: &Value, prefix: &str, errors: &mut Vec<String>) {
    let Some((longitude, latitude)) = position_pair(coordinates) else {
        errors.push(format!(
            "{prefix} must be a [longitude, latitude] number pair"
        ));
        return;
    };

    if !(-180.0..=180.0).contains(&longitude) || !(-90.0..=90.0).contains(&latitude) {
        errors.push(format!("{prefix} must be valid WGS84 longitude/latitude"));
    }
}

fn position_pair(coordinates: &Value) -> Option<(f64, f64)> {
    let values = coordinates.as_array()?;
    if values.len() < 2 {
        return None;
    }

    let longitude = values.first()?.as_f64()?;
    let latitude = values.get(1)?.as_f64()?;

    if longitude.is_finite() && latitude.is_finite() {
        Some((longitude, latitude))
    } else {
        None
    }
}

fn required_string<'a>(
    object: &'a Value,
    key: &str,
    prefix: &str,
    errors: &mut Vec<String>,
) -> Option<&'a str> {
    match object.get(key).and_then(Value::as_str) {
        Some(value) if !value.trim().is_empty() => Some(value),
        _ => {
            errors.push(format!("{prefix}.{key} must be a non-empty string"));
            None
        }
    }
}

fn non_negative_number(object: &Value, key: &str, prefix: &str, errors: &mut Vec<String>) {
    match object.get(key).and_then(Value::as_f64) {
        Some(value) if value.is_finite() && value >= 0.0 => {}
        _ => errors.push(format!("{prefix}.{key} must be a non-negative number")),
    }
}

fn is_approved_source_id(source_id: &str) -> bool {
    let Some(host) = https_host(source_id) else {
        return false;
    };
    // Federal core sources
    host == "api.usaspending.gov"
        || host.ends_with(".usaspending.gov")
        || host == "www.usaspending.gov"
        || host == "tigerweb.geo.census.gov"
        || host.ends_with(".census.gov")
        // Any official US government domain
        || has_tld(&host, "gov")
        // State/local open-data portals (Socrata, OpenGov) used by NV and other states
        || host.ends_with(".socrata.com")
        || host.ends_with(".opengov.com")
        // Tyler OpenFinance (used by many counties/cities)
        || host.ends_with(".tylertech.com")
}

fn has_official_host(url: &str, domain: &str) -> bool {
    let Some(host) = https_host(url) else {
        return false;
    };

    host == domain || host.ends_with(&format!(".{domain}"))
}

fn has_tld(host: &str, tld: &str) -> bool {
    host.rsplit('.')
        .next()
        .is_some_and(|part| part.eq_ignore_ascii_case(tld))
}

fn https_host(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://")?;
    let authority = rest.split(['/', '?', '#']).next()?;
    // Strip userinfo (user:password@) so "evil@legit.gov" is not approved as legit.gov
    let host_and_port = match authority.rfind('@') {
        Some(pos) => &authority[pos + 1..],
        None => authority,
    };
    let host = host_and_port.split(':').next()?.trim();
    if host.is_empty() {
        None
    } else {
        Some(host.to_ascii_lowercase())
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    use serde_json::{Value, json};
    use sha2::{Digest, Sha256};

    use super::{validate_manifest_root, validate_root};

    fn valid_fixture() -> Value {
        json!({
            "sourceMeta": {
                "sources": [
                    "https://api.usaspending.gov/docs/",
                    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer"
                ]
            },
            "summary": {
                "totalPackages": 1,
                "totalPotentialWaste": 100.0,
                "totalBudget": 100.0
            },
            "legend": {},
            "geo": {
                "type": "FeatureCollection",
                "features": [{
                    "type": "Feature",
                    "geometry": { "type": "Point", "coordinates": [0, 0] },
                    "properties": { "regionKey": "county-nv-001" }
                }]
            },
            "regions": [{
                "regionKey": "county-nv-001",
                "regionName": "Churchill County",
                "regionType": "County",
                "provinceName": "Nevada",
                "totalBudget": 100.0,
                "totalPotentialWaste": 100.0
            }],
            "provinceView": {
                "geo": {
                    "type": "FeatureCollection",
                    "features": [{
                        "type": "Feature",
                        "geometry": { "type": "Point", "coordinates": [0, 0] },
                        "properties": { "provinceKey": "state-nv" }
                    }]
                },
                "provinces": [{ "provinceKey": "state-nv" }]
            },
            "ownerLists": {},
            "packageSamples": [{
                "id": "award-1",
                "sourceId": "https://www.usaspending.gov/award/ASST_NON_TEST_012",
                "packageName": "Official source record",
                "ownerName": "USAspending.gov",
                "budget": 100.0,
                "regionKeys": ["county-nv-001"],
                "provinceKeys": ["state-nv"]
            }]
        })
    }

    #[test]
    fn accepts_valid_fixture() {
        assert!(validate_root(&valid_fixture()).is_ok());
    }

    #[test]
    fn rejects_spoofed_source_hosts() {
        let mut fixture = valid_fixture();
        fixture["sourceMeta"]["sources"] = json!([
            "https://example.com/usaspending.gov",
            "https://example.com/census.gov"
        ]);

        let errors = validate_root(&fixture).expect_err("spoofed hosts should fail");
        assert!(errors.iter().any(|error| error.contains("USAspending")));
        assert!(errors.iter().any(|error| error.contains("Census")));
    }

    #[test]
    fn rejects_bad_package_region_keys() {
        let mut fixture = valid_fixture();
        fixture["packageSamples"][0]["regionKeys"] = json!([123, "missing-region"]);

        let errors = validate_root(&fixture).expect_err("bad region keys should fail");
        assert!(
            errors
                .iter()
                .any(|error| error.contains("must be a string"))
        );
        assert!(errors.iter().any(|error| error.contains("unknown region")));
    }

    #[test]
    fn rejects_bad_package_province_keys() {
        let mut fixture = valid_fixture();
        fixture["packageSamples"][0]["provinceKeys"] = json!([false, "missing-province"]);

        let errors = validate_root(&fixture).expect_err("bad province keys should fail");
        assert!(
            errors
                .iter()
                .any(|error| error.contains("must be a string"))
        );
        assert!(
            errors
                .iter()
                .any(|error| error.contains("unknown province"))
        );
    }

    #[test]
    fn rejects_geo_feature_without_known_region_key() {
        let mut fixture = valid_fixture();
        fixture["geo"]["features"][0]["properties"] = json!({ "regionKey": "missing-region" });

        let errors = validate_root(&fixture).expect_err("bad feature region key should fail");
        assert!(errors.iter().any(|error| error.contains("unknown key")));
    }

    #[test]
    fn rejects_malformed_geo_coordinates() {
        let mut fixture = valid_fixture();
        fixture["geo"]["features"][0]["geometry"] = json!({
            "type": "Polygon",
            "coordinates": [[[-115.0, 36.0], [-114.0], [-114.0, 37.0], [-116.0, 36.0]]]
        });

        let errors = validate_root(&fixture).expect_err("bad coordinates should fail");
        assert!(
            errors
                .iter()
                .any(|error| error.contains("longitude, latitude"))
        );
        assert!(
            errors
                .iter()
                .any(|error| error.contains("closed linear ring"))
        );
    }

    #[test]
    fn accepts_valid_manifest_fixture() {
        let root = temp_root("valid-manifest");
        write_fixture_file(&root, "index.html", b"<main>ok</main>");
        write_fixture_file(&root, "assets/js/app.js", b"console.log('ok');");
        write_fixture_file(&root, "data/bootstrap.json", br#"{"ok":true}"#);

        let manifest = manifest_for(
            &root,
            &["assets/js/app.js", "data/bootstrap.json", "index.html"],
        );
        let report = validate_manifest_root(&manifest, &root, &root.join("data/manifest.json"))
            .expect("valid manifest should pass");

        assert_eq!(report.files, 3);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn rejects_tampered_manifest_hash() {
        let root = temp_root("tampered-manifest");
        write_fixture_file(&root, "index.html", b"<main>ok</main>");

        let mut manifest = manifest_for(&root, &["index.html"]);
        manifest["files"][0]["sha256"] =
            json!("0000000000000000000000000000000000000000000000000000000000000000");

        let errors = validate_manifest_root(&manifest, &root, &root.join("data/manifest.json"))
            .expect_err("tampered manifest should fail");

        assert!(
            errors
                .iter()
                .any(|error| error.contains("does not match file hash"))
        );
        fs::remove_dir_all(root).ok();
    }

    fn temp_root(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "spending-validate-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(&root).expect("test root should be creatable");
        root
    }

    fn write_fixture_file(root: &Path, relative: &str, body: &[u8]) {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("fixture directory should be creatable");
        }
        fs::write(path, body).expect("fixture file should be writable");
    }

    fn manifest_for(root: &Path, paths: &[&str]) -> Value {
        json!({
            "schema_version": 1,
            "algorithm": "sha256",
            "root": "frontend",
            "files": paths.iter().map(|path| {
                let body = fs::read(root.join(path)).expect("fixture file should exist");
                let digest = Sha256::digest(&body);
                json!({
                    "path": path,
                    "bytes": body.len(),
                    "sha256": format!("{digest:x}")
                })
            }).collect::<Vec<_>>()
        })
    }
}
