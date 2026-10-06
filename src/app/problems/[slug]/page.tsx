import { notFound } from "next/navigation";
import { getProblem, readySlugs } from "@/content/registry";
import { JourneyViewer } from "@/components/journey/JourneyViewer";

export function generateStaticParams() {
  return readySlugs().map((slug) => ({ slug }));
}

export default async function ProblemPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const problem = getProblem(slug);
  if (!problem) notFound();
  return <JourneyViewer problem={problem} />;
}
