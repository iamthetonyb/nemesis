use std::{collections::HashSet, env, fs, path::PathBuf, process};

use serde_json::Value;

fn main() {
    let path = env::args_os().nth(1).map_or_else(
        || PathBuf::from("frontend/data/bootstrap.json"),
        PathBuf::from,
    );

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
}

#[derive(Debug)]
struct Report {
    regions: usize,
    packages: usize,
    sources: usize,
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
            && !source_id.starts_with("https://api.usaspending.gov/")
            && !source_id.starts_with("https://www.usaspending.gov/award/")
            && !source_id.starts_with("https://tigerweb.geo.census.gov/")
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

fn has_official_host(url: &str, domain: &str) -> bool {
    let Some(host) = https_host(url) else {
        return false;
    };

    host == domain || host.ends_with(&format!(".{domain}"))
}

fn https_host(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://")?;
    let host_and_port = rest.split(['/', '?', '#']).next()?;
    let host = host_and_port.split(':').next()?.trim();
    if host.is_empty() {
        None
    } else {
        Some(host.to_ascii_lowercase())
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::validate_root;

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
}
