import type { FeedbackDeps } from "./ai/feedback";
import type { Store } from "./store";

export interface AppContext {
  store: Store;
  ownerToken: string;
  feedback: FeedbackDeps;
}
