import { writeFile } from "node:fs/promises";

const SITE_URL = "https://gov-budget.pages.dev";
const routes = [
  { path: "/", priority: "1.0", changefreq: "weekly" },
  { path: "/legal/privacy", priority: "0.4", changefreq: "yearly" },
  { path: "/legal/security-policy", priority: "0.4", changefreq: "yearly" },
];

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes
  .map(
    (route) => `  <url>
    <loc>${SITE_URL}${route.path}</loc>
    <changefreq>${route.changefreq}</changefreq>
    <priority>${route.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>
`;

await writeFile("frontend/sitemap.xml", xml);
