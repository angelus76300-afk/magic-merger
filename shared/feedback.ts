// The Feedback tab (3.4.1): ideas from invited players, their votes, and what
// became of each one once the admin sent it to Claude. Shared by the page and
// the Worker.

export const SUGGESTION_STATUSES = ["open", "sent", "question", "review", "shipped", "declined"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

// What players read on each idea.
export const STATUS_LABEL: Record<SuggestionStatus, string> = {
  open: "Open for votes",
  sent: "Claude is on it",
  // Claude stopped to ask instead of guessing; the admin sends a clearer brief.
  question: "Claude has a question",
  review: "Waiting for review",
  shipped: "Done, in the next update",
  declined: "Not this time",
};

export const TITLE_MAX = 80;
export const BODY_MAX = 1000;
// The brief the admin sends: room for acceptance criteria, far under the
// routine's 65,536 characters.
export const BRIEF_MAX = 8000;
// Ideas one invite may post in a day (the admin has no limit).
export const POSTS_PER_DAY = 5;

export interface Suggestion {
  id: number;
  title: string;
  body: string;
  // The invite's name, "admin", or "local" in mock mode.
  by: string;
  mine: boolean;
  votes: number;
  voted: boolean;
  status: SuggestionStatus;
  // Why it was declined, when there is a reason.
  note: string | null;
  createdAt: number;
  updatedAt: number;
  issueUrl: string | null;
  prUrl: string | null;
  // Admin only.
  brief?: string | null;
  sessionUrl?: string | null;
}

export interface FeedbackResponse {
  suggestions: Suggestion[];
  // Admin only: what is missing before an idea can be sent to Claude (secret
  // and variable names), empty when everything is set.
  missing?: string[];
}

export interface FeedbackAction {
  id: number;
  action: "send" | "decline" | "reopen" | "delete";
  brief?: string;
  note?: string;
}
