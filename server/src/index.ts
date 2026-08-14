import { app } from "./app.js";

// Deliberately not PORT: some launchers export PORT for the web dev server, and
// the API silently binding to that port breaks the proxy in confusing ways.
const port = Number(process.env.API_PORT ?? 4001);

// Loopback only: this app handles clinical data and must not be reachable from the LAN.
app.listen(port, "127.0.0.1", () => {
  console.log(`API listening on http://127.0.0.1:${port}`);
});
