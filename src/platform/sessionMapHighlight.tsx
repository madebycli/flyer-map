import { createContext, useContext, type ReactNode } from "react";
import "./session-map-highlight.css";

export type SessionMapHighlight = {
  campaignId: string;
  sessionId: string;
  label: string;
  streetTaskIds: readonly string[];
  houseTaskCount: number;
};

const SessionMapHighlightContext = createContext<SessionMapHighlight | null>(null);

export function SessionMapHighlightProvider({
  value,
  children,
}: {
  value: SessionMapHighlight | null;
  children: ReactNode;
}) {
  return (
    <SessionMapHighlightContext.Provider value={value}>
      {children}
    </SessionMapHighlightContext.Provider>
  );
}

export function useSessionMapHighlight() {
  return useContext(SessionMapHighlightContext);
}
