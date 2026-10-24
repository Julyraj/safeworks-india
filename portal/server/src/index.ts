import { config } from "./config.js";
process.env.TZ = config.timezone;

import { buildApp } from "./app.js";
import { pool } from "./db.js";
import { startJobs } from "./jobs.js";
import { migrate } from "./migrate.js";

async function main() {
  if (config.isProd && config.fileSigningSecret.length < 32) throw new Error("FILE_SIGNING_SECRET must be at least 32 characters.");
  if (process.env.AUTO_MIGRATE !== "false") await migrate();
  const app = await buildApp({ logger: true });
  const stopJobs = config.runJobs ? startJobs() : () => {};
  await app.listen({ port: config.port, host: config.host });
  console.log(`SafeWorks Portal listening on http://${config.host}:${config.port}`);

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down…`);
    stopJobs();
    try {
      await app.close();
      await pool.end();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
