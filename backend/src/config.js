const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const ROOT_DIR = path.resolve(__dirname, "..");

function resolveFromRoot(value, fallback) {
  const target = value || fallback;
  return path.isAbsolute(target) ? target : path.join(ROOT_DIR, target);
}

const port = Number(process.env.PORT || 3000);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("PORT must be a positive integer.");
}

const DATA_DIR = resolveFromRoot(process.env.DATA_DIR, "data");
const DATASET_DIR = resolveFromRoot(process.env.AUDIT_DATASET_DIR, "dataset");
const GEO_ROOT_PATH = resolveFromRoot(process.env.GEO_ROOT_PATH, path.join("seed", "geo"));

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  DATASET_DIR,
  GEO_ROOT_PATH,
  PORT: port,
  CORS_ORIGIN: process.env.CORS_ORIGIN || "*",
  DB_PATH: resolveFromRoot(process.env.SQLITE_PATH, path.join("data", "dashboard.sqlite")),
  GEOJSON_PATH: resolveFromRoot(process.env.GEOJSON_PATH, path.join(GEO_ROOT_PATH, "03-districts")),
  PROVINCE_GEOJSON_PATH: resolveFromRoot(
    process.env.PROVINCE_GEOJSON_PATH,
    path.join(GEO_ROOT_PATH, "02-provinces", "province-only")
  ),
  AUDIT_DATASET_DIR: DATASET_DIR,
  AUDIT_DATASET_YEAR: String(process.env.AUDIT_DATASET_YEAR || "2026").trim(),
  DEFAULT_REGION_PAGE_SIZE: 25,
  MAX_REGION_PAGE_SIZE: 100,
};
