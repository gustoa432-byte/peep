import { createFileRoute } from "@tanstack/react-router";
import { ItemForge } from "@/components/peep/item-forge";

export const Route = createFileRoute("/editor")({
  ssr: false,
  component: EditorPage,
});

function EditorPage() {
  return <ItemForge />;
}
