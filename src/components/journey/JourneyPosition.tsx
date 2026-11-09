"use client";
// Lets StageEvolve / StageFlows restore and report their position without changing stage component props.
import { createContext, useContext } from "react";

export interface JourneyPositionValue {
  evolveStep?: number;
  flowId?: string;
  onEvolveStep(step: number): void;
  onFlow(flowId: string): void;
}

export const JourneyPositionContext = createContext<JourneyPositionValue | null>(null);

export function useJourneyPosition(): JourneyPositionValue | null {
  return useContext(JourneyPositionContext);
}
