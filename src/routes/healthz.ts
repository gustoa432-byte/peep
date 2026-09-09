import { createFileRoute } from "@tanstack/react-router";

const ok = () =>
  new Response("ok", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });

export const Route = createFileRoute("/healthz")({
  server: { handlers: { GET: ok, HEAD: ok } },
});
