import { createApp } from "./app.js";

const { app, monitor, config } = await createApp();

try {
  await app.listen({
    host: config.host,
    port: config.port,
  });

  monitor.start();
  app.log.info({ port: config.port, host: config.host }, "stablecoin-payments-service started");
} catch (error) {
  app.log.error({ err: error }, "Failed to start server");
  await app.close();
  process.exitCode = 1;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close();
  });
}
