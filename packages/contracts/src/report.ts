/** Read-only P6 projection. All text is stored evidence, never generated on GET. */
export interface ReportEvidence {
  sessionId: string;
  sessionNumber: number;
  heldAt: string;
  /** Stored field or canonical record-projection path within the source session. */
  source: string;
  text: string;
}

export interface SupportCaseReport {
  schemaVersion: 1;
  supportCaseId: string;
  beneficiaryId: string;
  programId: string;
  programName: string | null;
  status: 'active' | 'closed';
  sessions: Array<{
    sessionId: string;
    sessionNumber: number;
    heldAt: string;
    kind: 'regular' | 'intake';
    channel: 'in_person' | 'phone' | 'video';
    /** Approved one-liner/summary excerpt, otherwise a sourced manual excerpt. */
    summary?: ReportEvidence;
  }>;
  /** One verbatim plan from the first intake, not the mutable current overall goal. */
  firstIntakeGoal?: ReportEvidence;
  /** Explicit intake follow-up questions; no section/category is inferred. */
  nextConfirmations?: Array<{
    item: string;
    reason?: string;
    method?: string;
    dueNote?: string;
    dueDate?: string;
    owner?: string;
    evidence: ReportEvidence;
  }>;
  /** No evidence means the section is absent, not "no risk" or "no change". */
  sections: {
    situationChanges?: { entries: ReportEvidence[] };
    goalChanges?: { initialGoal: ReportEvidence; directions: ReportEvidence[] };
    actionItems?: { items: Array<{
      id: string;
      description: string;
      resolutionStatus: 'done' | 'in_progress' | 'not_done' | 'hold' | null;
      resolvedAt: string | null;
      dueDate: string | null;
      evidence: ReportEvidence;
      resolution?: ReportEvidence;
    }> };
    resourceConnections?: { entries: Array<{
      orgName: string;
      serviceName?: string;
      supportDetail?: string;
      usagePeriod?: string;
      progressStatus?: string;
      evidence: ReportEvidence;
    }> };
    riskSignals?: { entries: ReportEvidence[] };
  };
}
