import type { Metadata } from "next";
import { getProblem, readySlugs } from "@/content/registry";
import type { ProblemOutline } from "@/lib/progress/logic";
import { ProfileView } from "@/components/profile/ProfileView";

export const metadata: Metadata = {
  title: "Your profile · SysDesign Studio",
  description: "Pick up where you left off.",
};

/** Only the fields progress needs, so the client bundle doesn't carry every problem's full content. */
function outlines(): ProblemOutline[] {
  return readySlugs().flatMap((slug) => {
    const p = getProblem(slug);
    if (!p) return [];
    return [{
      slug: p.slug,
      title: p.title,
      tagline: p.tagline,
      difficulty: p.difficulty,
      interviewQuestion: p.interviewQuestion,
      estimates: p.estimates.map((e) => ({ result: e.result })),
      v1: { title: p.v1.title },
      evolution: p.evolution.map((s) => ({ version: s.version, title: s.title })),
      flows: p.flows.map((f) => ({ id: f.id, name: f.name })),
      deepDives: p.deepDives.map((d) => ({ title: d.title })),
      quiz: p.quiz?.length
        ? { core: p.quiz.filter((q) => q.level === "core").length, interviewer: p.quiz.filter((q) => q.level === "interviewer").length }
        : undefined,
    }];
  });
}

export default function ProfilePage() {
  return <ProfileView problems={outlines()} />;
}
