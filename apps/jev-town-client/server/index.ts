import { createApp } from "./app.ts";
import { loadJevConfig } from "./jevClient.ts";

const port = Number(process.env.PORT) || 8787;
const app = createApp();

app.listen(port, () => {
  const configured = loadJevConfig() !== null;
  console.log(`[server] Jev Town API listening on http://localhost:${port}`);
  console.log(
    configured
      ? "[server] Jev is configured: real citizen decisions are live."
      : "[server] TYPESAFE_API_KEY not set: running on the local simulation fallback.",
  );
});
