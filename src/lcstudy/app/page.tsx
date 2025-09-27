import { getAuthSession } from "@/lib/auth";
import Dashboard from "@/components/dashboard";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const session = await getAuthSession();

  if (!session?.user) {
    redirect("/signin");
  }

  return <Dashboard user={session.user} />;
}
