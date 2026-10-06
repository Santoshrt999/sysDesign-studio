import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center justify-center px-6">
      <div className="w-full rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm">
        <div className="text-sm font-semibold uppercase tracking-[0.2em] text-stone-400">404</div>
        <h1 className="mt-3 text-3xl font-semibold text-stone-900">Page not found</h1>
        <p className="mt-3 text-stone-600">The design journey you are looking for does not exist or has moved.</p>
        <Link href="/" className="mt-6 inline-flex rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-stone-700">
          Back to the studio
        </Link>
      </div>
    </main>
  );
}
