import { createApp } from "../src/server.js";

const { server } = createApp();

export default function handler(req, res) {
  server.emit("request", req, res);
}
