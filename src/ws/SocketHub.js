export class SocketHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = new Map();
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();

    let driverId = null;

    server.addEventListener("message", async (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === "auth") {
        driverId = msg.driverId;
        this.clients.set(driverId, server);

        server.send(JSON.stringify({
          type: "auth_ok",
          driverId
        }));
      }

      if (msg.type === "ping") {
        server.send(JSON.stringify({ type: "pong" }));
      }
    });

    server.addEventListener("close", () => {
      if (driverId) this.clients.delete(driverId);
    });

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  broadcast(type, data) {
    const msg = JSON.stringify({ type, data });

    for (const ws of this.clients.values()) {
      try {
        ws.send(msg);
      } catch {}
    }
  }
}