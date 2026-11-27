/**
 * True for a path inside this site ("/dashboard/..."). Links the app follows on
 * the user's behalf (notification links) must never lead to another site or run
 * a javascript: URL, even if a bad value ever reached the database.
 */
export function isInAppPath(link: string | null | undefined): link is string {
  return (
    typeof link === "string" &&
    link.startsWith("/") &&
    !link.startsWith("//") &&
    !link.includes("\\")
  );
}
