import { AuthSetupMissing } from "@/components/AuthSetupMissing";
import { getClerkConfigStatus } from "@/lib/auth-config";
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  if (!getClerkConfigStatus().configured) {
    return <AuthSetupMissing />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <SignIn
        appearance={{
          elements: {
            rootBox: "mx-auto",
            card: "rounded-xl border shadow-lg",
          },
        }}
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/dashboard"
      />
    </div>
  );
}
