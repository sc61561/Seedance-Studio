import { cookies } from "next/headers";

import { VideoGenerator } from "@/components/studio/video-generator";
import {
  resolveAuthGateState,
  sessionCookieName,
} from "@/lib/auth/session";

export default async function Home() {
  const cookieStore = await cookies();
  const session = cookieStore.get(sessionCookieName)?.value;

  return <VideoGenerator initialAuthState={resolveAuthGateState(session)} />;
}
