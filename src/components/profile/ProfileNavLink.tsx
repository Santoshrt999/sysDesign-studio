"use client";
import Link from "next/link";
import { useProgress } from "@/lib/progress/ProgressProvider";

export function ProfileNavLink({ className = "" }: { className?: string }) {
  const { status, file } = useProgress();
  return (
    <Link href="/profile" className={className}>
      {status === "ready" && !file ? "Create profile" : "Profile"}
    </Link>
  );
}
