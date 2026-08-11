import type { AppFastify } from "../types.js";
import type { SandboxManager } from "../sandbox/manager.js";

export function registerSandboxRoutes(app: AppFastify, manager: SandboxManager): void {
  app.get("/api/sandbox/status", async () => {
    const detection = await manager.refreshDetection();
    return { status: manager.statusPayload(detection) };
  });

  app.post("/api/sandbox/prepare", async () => {
    return manager.prepare();
  });

  app.post("/api/sandbox/self-test", async () => {
    return manager.selfTest();
  });
}
