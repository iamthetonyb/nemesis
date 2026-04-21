const { AUDIT_DATASET_DIR, GEO_ROOT_PATH } = require("../src/config");
const { openDatabase, resolveRuntimeDbPath } = require("../src/db");
const { createSchema, seedDatabase } = require("../src/seed");

const runtimeDbPath = resolveRuntimeDbPath();
const db = openDatabase();

try {
  createSchema(db);
  const summary = seedDatabase(db);
  const sourceSuffix = summary.sourceFileCount > 1 ? ` (${summary.sourceFileCount} files)` : "";

  console.log(`Database reset complete at ${runtimeDbPath}`);
  console.log(`Dataset directory: ${AUDIT_DATASET_DIR}`);
  console.log(`Geo root directory: ${GEO_ROOT_PATH}`);
  console.log(`Assets: ${summary.assetCount}`);
  console.log(`Regions: ${summary.regionCount}`);
  console.log(`Packages: ${summary.packageCount}`);
  console.log(`Mapped packages: ${summary.mappedPackageCount}`);
  console.log(`Unmapped packages: ${summary.unmappedPackageCount}`);
  console.log(`Multi-location packages: ${summary.multiLocationPackageCount}`);
  console.log(`Source: ${summary.sourceFormat} @ ${summary.sourcePath}${sourceSuffix}`);
} finally {
  db.close();
}
