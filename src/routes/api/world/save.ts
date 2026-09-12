import { createFileRoute } from "@tanstack/react-router";
import { saveWorldSnapshot } from "@/lib/peep/world-save.server";

async function handle({ request }: { request: Request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  let body: unknown;
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const result = await saveWorldSnapshot(body);
  if (!result.ok) {
    return Response.json(result, { status: 400 });
  }
  return Response.json(result, {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}

export const Route = createFileRoute("/api/world/save")({
  server: { handlers: { POST: handle, OPTIONS: handle } },
});
