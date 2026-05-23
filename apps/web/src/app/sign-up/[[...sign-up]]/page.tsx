import { AuthSetupMissing } from "@/components/AuthSetupMissing";
import { getClerkConfigStatus } from "@/lib/auth-config";
import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  if (!getClerkConfigStatus().configured) {
    return <AuthSetupMissing />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <SignUp
        appearance={{
          elements: {
            rootBox: "mx-auto",
            card: "rounded-xl border shadow-lg",
          },
        }}
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        fallbackRedirectUrl="/dashboard"
      />
    </div>
  );
}
