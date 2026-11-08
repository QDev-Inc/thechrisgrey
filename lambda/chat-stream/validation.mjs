export const VALID_ROLES = new Set(["user", "assistant"]);
export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_MESSAGE_COUNT = 50;

export const VALID_PATHS = new Set([
  "/",
  "/about",
  "/altivum",
  "/foundation",
  "/podcast",
  "/beyond-the-assessment",
  "/aws",
  "/claude",
  "/blog",
  "/contact",
  "/links",
  "/chat",
  "/privacy",
  "/newsletter/confirm",
  "/admin",
  "/blueprint",
]);
export const BLOG_SLUG_PATTERN = /^\/blog\/[a-z0-9][a-z0-9-]*$/;
export const SAFE_TEXT_PATTERN = /^[a-zA-Z0-9 ()/:,&'-]+$/;

/**
 * Real routes that must never be offered as a LINK. /admin is the Cognito-gated
 * console and /chat is where the visitor already is (or, from the widget, a
 * context switch nobody asked for).
 *
 * Both link-emitting surfaces read this: tools/navigate.mjs refuses these paths
 * with its own "restricted" copy, and uiBlocks.mjs rejects them at the schema so
 * a render_ui block cannot carry one. They had a private copy each, and the
 * client is no backstop — GenerativeBlocks.tsx only checks the leading slash.
 */
export const UNLINKABLE_PATHS = new Set(["/admin", "/chat"]);

/** @param {string} path @returns {boolean} */
export function isValidPath(path) {
  return VALID_PATHS.has(path) || BLOG_SLUG_PATTERN.test(path);
}

/**
 * isValidPath minus UNLINKABLE_PATHS — the predicate for "may appear as a link".
 * @param {string} path @returns {boolean}
 */
export function isLinkablePath(path) {
  return isValidPath(path) && !UNLINKABLE_PATHS.has(path);
}

/**
 * Strip a trailing slash so production paths (Amplify serves "/chat/") and any
 * stale client bundle resolve to the canonical form ("/chat") before validation.
 * The root path "/" is preserved.
 * @param {any} path @returns {any}
 */
export function normalizePath(path) {
  if (typeof path !== "string") return path;
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/**
 * Validate a message history array.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @returns {{ valid: true } | { valid: false, error: string }}
 */
export function validateInput(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { valid: false, error: "Please send a message to start our conversation." };
  }
  if (messages.length > MAX_MESSAGE_COUNT) {
    return { valid: false, error: "Conversation history is too long. Please start a new conversation." };
  }
  for (const msg of messages) {
    if (!msg || typeof msg.content !== "string") {
      return { valid: false, error: "Invalid message format." };
    }
    if (msg.content.trim().length === 0) {
      return { valid: false, error: "Please enter a message." };
    }
    if (msg.content.length > MAX_MESSAGE_LENGTH) {
      return { valid: false, error: "Your message is too long. Please keep messages under 4000 characters." };
    }
    if (!msg.role || !VALID_ROLES.has(msg.role)) {
      return { valid: false, error: "Invalid message format." };
    }
  }
  return { valid: true };
}

/**
 * Sanitize pageContext from a request. Returns null on any validation failure
 * rather than partial data — the caller then simply omits visitor context.
 */
/** @param {any} pageContext */
export function validatePageContext(pageContext) {
  if (!pageContext || typeof pageContext !== "object") return null;

  const { pageTitle, section, visitedPages } = pageContext;
  const currentPage = normalizePath(pageContext.currentPage);

  if (typeof currentPage !== "string" || !isValidPath(currentPage)) return null;
  if (typeof section !== "string" || section.length > 100 || !SAFE_TEXT_PATTERN.test(section)) return null;

  const sanitizedVisitedPages = Array.isArray(visitedPages)
    ? visitedPages
        .filter((p) => typeof p === "string")
        .map(normalizePath)
        .filter(isValidPath)
        .slice(0, 20)
    : [];

  return {
    currentPage,
    pageTitle:
      typeof pageTitle === "string" && SAFE_TEXT_PATTERN.test(pageTitle.slice(0, 100)) ? pageTitle.slice(0, 100) : "",
    section,
    visitedPages: sanitizedVisitedPages,
  };
}

/** @param {any[]} messages @returns {string|null} */
export function getLatestUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      return messages[i].content;
    }
  }
  return null;
}
