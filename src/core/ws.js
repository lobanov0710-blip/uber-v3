export class SocketHub {

  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = new Map();
  }

  async fetch(request) {

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WS", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();

    let id = null;

    server.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);

      if (msg.type === "auth") {
        id = msg.id;
        this.clients.set(id, server);

        server.send(JSON.stringify({
          type: "ok",
          id
        }));
      }
    });

    server.addEventListener("close", () => {
      if (id) this.clients.delete(id);
    });

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }
}