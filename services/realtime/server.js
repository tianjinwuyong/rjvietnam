import {
  createJsonResponder,
  resolveListenPort,
  startHttpService,
} from "../_shared/runtime.js";

const requestedPort = resolveListenPort(process.env.REALTIME_PORT ?? process.env.PORT, 8081, "realtime");

const { getPort } = startHttpService({
  serviceName: "realtime",
  requestedPort,
  handler: (req, res) => {
    if ((req.url ?? "/") === "/health") {
      createJsonResponder(res, 200, {
        ok: true,
        service: "realtime",
        port: getPort(),
        status: "ready",
      });
      return;
    }

    createJsonResponder(res, 200, {
      ok: true,
      service: "realtime",
      port: getPort(),
      message: "Realtime service running",
    });
  },
});
