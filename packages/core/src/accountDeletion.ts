// Deleting an account (SPEC "Deleting an account"); Parser.kt is the
// Kotlin twin.

export const accountDeletePath = "/account/delete";

// The parser's answer (410) to a request from an account whose deletion
// stopped part way: the sign-in, which goes last, is still there. The apps
// offer to finish deleting it, as a second `POST /account/delete` does.
export const deletionUnfinishedText = "Deleting your account didn't finish.";

export function isDeletionUnfinished(status: number, body: string): boolean {
  return status === 410 && body.trim() === deletionUnfinishedText;
}
