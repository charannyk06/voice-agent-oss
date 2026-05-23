import { AuthSetupMissing } from "@/components/AuthSetupMissing";
import { getClerkConfigStatus } from "@/lib/auth-config";
import { redirect } from "next/navigation";

export default function Home() {
  if (!getClerkConfigStatus().configured) {
    return <AuthSetupMissing />;
  }

  redirect("/dashboard");
}
