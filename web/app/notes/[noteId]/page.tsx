import { NoteEditor } from "../../../components/NoteEditor";

export const dynamic = "force-dynamic";

export default async function NotePage({ params }: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await params;
  return <NoteEditor noteId={noteId} />;
}
