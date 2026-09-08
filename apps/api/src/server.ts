import { createApp } from "./app"

const port = Number(Bun.env.PORT ?? 3001)
const managementSocket = Bun.env.MANAGEMENT_UNIX_SOCKET?.trim()
const app = createApp()

const serverOptions = { idleTimeout: 90, fetch: app.fetch }
const loopbackServer = Bun.serve({ ...serverOptions, hostname: "127.0.0.1", port })
if (managementSocket) Bun.serve({ ...serverOptions, unix: managementSocket })

console.log(
  managementSocket
    ? `Conference API listening on http://${loopbackServer.hostname}:${loopbackServer.port} and unix://${managementSocket}`
    : `Conference API listening on http://${loopbackServer.hostname}:${loopbackServer.port}`,
)
