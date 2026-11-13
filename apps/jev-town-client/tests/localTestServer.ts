import type { createApp } from "../server/app.ts";
const realFetch = globalThis.fetch;

export async function withLocalServer<T>(
  app: ReturnType<typeof createApp>,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  // Some operating systems can allocate a dynamic port that Fetch rejects
  // before connecting. Validate only the local transport before running any
  // assertions; retry that precise condition, never a failed test callback.
  for (let attempt = 0; attempt < 8; attempt++) {
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    try {
      const address = server.address();
      if (typeof address !== "object" || address === null) throw new Error("no server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      try {
        const response = await realFetch(`${baseUrl}/api/status`);
        await response.arrayBuffer();
      } catch (error) {
        if ((error as { cause?: { message?: string } }).cause?.message === "bad port") continue;
        throw error;
      }
      return await run(baseUrl);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
  throw new Error("Unable to allocate a local test port accepted by Fetch");
}

