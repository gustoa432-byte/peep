import { createFileRoute } from "@tanstack/react-router";
import { loadWorldSnapshot } from "@/lib/peep/world-save.server";

async function handle({ request }: { request: Request }) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("tg_user_id")?.trim() ?? "";
  const result = await loadWorldSnapshot(raw);
  if (!result.ok) {
    return Response.json(result, { status: 400 });
  }
  return Response.json(result, {
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/world/load")({
  server: { handlers: { GET: handle } },
});
