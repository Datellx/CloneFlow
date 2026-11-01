import { Logo } from "@/components/domain";
import { LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-paper px-6 text-center">
      <Logo />
      <h1 className="mt-6 text-4xl font-normal">This page doesn't exist.</h1>
      <p className="text-ink-muted">The link may be old, or the page was moved.</p>
      <LinkButton to="/">Go to the home page</LinkButton>
    </div>
  );
}
