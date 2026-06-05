import { createServer } from "node:http";
import app from "./app.js";
import { initRealtime } from "./lib/realtime.js";

const port = Number(process.env.PORT) || 4000;

const httpServer = createServer(app);
initRealtime(httpServer);

httpServer.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend rodando na porta ${port} (HTTP + Socket.IO)`);
});
