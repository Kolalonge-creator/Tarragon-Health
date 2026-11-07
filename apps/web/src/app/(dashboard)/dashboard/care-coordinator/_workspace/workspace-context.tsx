"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/** Who is using the workspace, and the patient whose side panel is open. Set once by the layout. */
export type WorkspaceViewer = {
  userId: string;
  firstName: string | null;
  /** A doctor covering coordination rather than a Care Coordinator (CC-1). */
  covering: boolean;
};

type Ctx = WorkspaceViewer & {
  panelPatientId: string | null;
  openPatient: (patientId: string) => void;
  closePatient: () => void;
};

const WorkspaceContext = createContext<Ctx | null>(null);

export function WorkspaceProvider({ viewer, children }: { viewer: WorkspaceViewer; children: ReactNode }) {
  const [panelPatientId, setPanelPatientId] = useState<string | null>(null);
  return (
    <WorkspaceContext.Provider
      value={{ ...viewer, panelPatientId, openPatient: setPanelPatientId, closePatient: () => setPanelPatientId(null) }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): Ctx {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside the coordination workspace");
  return ctx;
}
