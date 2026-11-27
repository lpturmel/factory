import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

const readerPort = Number(process.env.READER_PORT ?? 4317);

export default defineConfig({
  plugins: [solid()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.PORT ?? 5173),
    proxy: { "/api": { target: `http://127.0.0.1:${readerPort}`, changeOrigin: true } },
  },
});
