import { SessionBoard } from "../components/SessionBoard";

// Notes are patient data: never prerendered, never cached.
export const dynamic = "force-dynamic";

export default function SessionBoardPage() {
  return <SessionBoard />;
}
