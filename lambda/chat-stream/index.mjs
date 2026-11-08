import { BedrockAgentRuntimeClient, RetrieveCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { ApplyGuardrailCommand, BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { createClient as createSanityClient } from "@sanity/client";
import { randomUUID, timingSafeEqual } from "crypto";
import { checkRateLimit, checkCostBudget } from "lambda-shared/rateLimit";
import { createInferenceClient } from "lambda-shared/inference";
import { createKnowledgeClient } from "lambda-shared/knowledge";
import { validateDeviceId, hashDeviceId } from "lambda-shared/deviceId";

import { authenticateRequest } from "lambda-shared/requestAuth";
import { MetricsCollector } from "lambda-shared/metrics";
import { createLogger } from "lambda-shared/logger";
import { setRequestContext, captureError, addBreadcrumb, flushSentry } from "lambda-shared/errorTracking";
import { captureProductEvent, flushProductAnalytics } from "lambda-shared/productAnalytics";
import { validateInput, validatePageContext, getLatestUserMessage } from "./validation.mjs";
import { buildSystemPrompt } from "./prompts.mjs";
import { retrieveContext } from "./kbRetrieve.mjs";
import { buildBedrockModel, buildAgent, streamAgentResponse } from "./agent.mjs";
import { CloudflareModel } from "./cloudflareModel.mjs";
import { createPodcastKnowledgeClient, requiresPodcastSearch } from "./podcastKnowledge.mjs";
import { buildTools } from "./tools/index.mjs";
import { getFacts, forgetDevice } from "./memory.mjs";
import { emitEvent, EVENT_KINDS } from "./events.mjs";
import { detectGenUiIntent, renderGenUi } from "./genUi.mjs";

// Region and model id are env-first with the live values as defaults, matching
// the resource ids below and the rest of the fleet (mcp-server, blueprint,
// session-token). A model or region move is then a config change on the
// function, not a code edit and redeploy.
const REGION = process.env.AWS_REGION || "us-east-1";

const agentClient = createPodcastKnowledgeClient(
  createKnowledgeClient(new BedrockAgentRuntimeClient({ region: REGION })),
);
const bedrockRuntimeClient = createInferenceClient(new BedrockRuntimeClient({ region: REGION }), ApplyGuardrailCommand);
const dynamoClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cloudwatchClient = new CloudWatchClient({ region: REGION });

const sanityProjectId = process.env.SANITY_PROJECT_ID || "k5950b3w";
const sanityDataset = process.env.SANITY_DATASET || "production";
const sanityClient = sanityProjectId
  ? createSanityClient({
      projectId: sanityProjectId,
      dataset: sanityDataset,
      apiVersion: process.env.SANITY_API_VERSION || "2024-01-01",
      useCdn: true,
      timeout: 4000,
    })
  : null;

const MODEL_ID = process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const KNOWLEDGE_BASE_ID = process.env.KB_ID || "ARFYABW8HP";
const PODCAST_KNOWLEDGE_BASE_ID = process.env.PODCAST_KB_ID || "";
const GUARDRAIL_ID = process.env.GUARDRAIL_ID || "5kofhp46ssob";
const GUARDRAIL_VERSION = process.env.GUARDRAIL_VERSION || "5";
const SYSTEM_MESSAGE_PREFIX = "\x00SYS\x00";
const SIGNING_KEY = process.env.CHAT_SIGNING_KEY || "";
const SESSION_TOKEN_KEY = process.env.SESSION_TOKEN_KEY || "";
const BEDROCK_MAX_MESSAGES = 20;

const RATE_LIMIT_TABLE = "thechrisgrey-chat-ratelimit";
const RATE_LIMIT_WINDOW_SECONDS = 3600;
const CHAT_MAX_REQUESTS = 20;
// Erasure is dispatched ahead of the chat rate limiter and each call pages a
// whole memory partition with batched deletes, so it carries its own, much
// tighter bucket (same table, "forget-" prefix). A visitor clears memory a
// handful of times ever, so a low ceiling costs nothing and closes the
// amplification a replayed session token would otherwise buy.
const FORGET_MAX_REQUESTS = 5;
// The gen-ui branch is the only path to Opus, so it carries its own bucket
// (same table, "genui-" prefix) inside the 20/hr chat allowance. Five an hour is
// well above what the explicit "gen-ui" command sees in practice and still
// bounds what a scripted caller can spend on the most expensive model on the site.
const GENUI_MAX_REQUESTS = 5;
const AGENT_TIMEOUT_MS = 25_000;
const GENUI_TIMEOUT_MS = 20_000;

const startupLog = createLogger(null, { service: "chat-stream" });

if (!SESSION_TOKEN_KEY && !SIGNING_KEY) {
  startupLog.warn("startup_warning", {
    message: "Neither SESSION_TOKEN_KEY nor CHAT_SIGNING_KEY set — request authentication is DISABLED",
  });
}

if (!PODCAST_KNOWLEDGE_BASE_ID) {
  // buildTools drops search_podcast when this is unset, but the system prompt
  // still instructs the model to call it, so Ask The Vector degrades to the bio
  // KB with no other signal. Every Podcast* metric is downstream of a registered
  // tool, so the unconfigured state would otherwise be silent.
  startupLog.warn("startup_warning", {
    message: "PODCAST_KB_ID is unset — search_podcast is not registered and podcast questions answer ungrounded",
  });
}

/** @param {any} responseStream @param {string} message */
function writeSystemMessage(responseStream, message) {
  responseStream.write(SYSTEM_MESSAGE_PREFIX + message);
  responseStream.end();
}

/**
 * Whether a body-supplied deviceId contradicts the device its session token was
 * minted for. The token carries sha256(deviceId) (lambda-shared/sessionToken),
 * which is exactly the partition key memory.mjs derives, so the binding proves
 * the caller owns the partition it names — without it, one valid token reads or
 * erases ANY device's memory by naming it in the body.
 *
 * Returns false whenever there is nothing to compare: the legacy HMAC path
 * carries no device, and a local/dev run with SESSION_TOKEN_KEY unset verifies
 * with `deviceHash` undefined.
 *
 * @param {any} auth @param {string|null} deviceId @returns {boolean}
 */
function tokenDeviceMismatch(auth, deviceId) {
  if (!deviceId || auth?.method !== "token") return false;
  const bound = auth.deviceHash;
  if (typeof bound !== "string" || bound.length === 0) return false;
  const actual = Buffer.from(hashDeviceId(deviceId), "hex");
  const expected = Buffer.from(bound, "hex");
  return actual.length !== expected.length || !timingSafeEqual(actual, expected);
}

/**
 * Map a thrown error to the handler's response branch. Exported so the branch
 * logic is asserted against THIS function rather than a copy of it in a test
 * (a duplicated classifier stayed green while the real branches drifted).
 * @param {unknown} error @returns {"abort_timeout"|"guardrail_prestream"|"throttled"|"unhandled"}
 */
export function classifyError(error) {
  const name = error instanceof Error ? error.name : String(error);
  const message = error instanceof Error ? error.message || "" : "";
  if (name === "AbortError") return "abort_timeout";
  if (name === "ValidationException" && message.toLowerCase().includes("guardrail")) return "guardrail_prestream";
  if (name === "ThrottlingException" || name === "ServiceQuotaExceededException") return "throttled";
  return "unhandled";
}

/** @param {any[]} messages */
function toStrandsMessages(messages) {
  const truncated =
    messages.length > BEDROCK_MAX_MESSAGES ? messages.slice(messages.length - BEDROCK_MAX_MESSAGES) : messages;
  const windowed = truncated[0]?.role === "assistant" ? truncated.slice(1) : truncated;

  if (windowed.length === 0) return { history: [], latest: null };

  const latest = windowed[windowed.length - 1];
  if (latest.role !== "user") return { history: [], latest: null };

  const historyRaw = windowed.slice(0, -1);
  const history = historyRaw.map((/** @type {any} */ msg) => ({
    role: msg.role,
    content: [{ text: msg.content }],
  }));

  return { history, latest: latest.content };
}

/** @param {any} responseStream @param {any} payload */
function writeForgetResult(responseStream, payload) {
  responseStream.write(JSON.stringify(payload));
  responseStream.end();
}

/**
 * @param {any} event
 * @param {any} responseStream
 * @param {string} requestId
 * @param {{ record: any, flush: any }} metrics
 * @param {{ clientIp: string, auth: any }} ctx
 */
async function handleForget(event, responseStream, requestId, metrics, { clientIp, auth }) {
  const log = createLogger(requestId, { service: "chat-stream" });
  try {
    const rateLimit = await checkRateLimit(docClient, UpdateCommand, {
      table: RATE_LIMIT_TABLE,
      ip: clientIp,
      prefix: "forget-",
      maxRequests: FORGET_MAX_REQUESTS,
      windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
      ttlBuffer: RATE_LIMIT_WINDOW_SECONDS,
      requestId,
    });
    if (!rateLimit.allowed) {
      metrics.record("ForgetRateLimitRejection");
      log.info("forget_rate_limited");
      writeForgetResult(responseStream, { ok: false, error: "Too many requests. Please try again later." });
      return;
    }

    const body = JSON.parse(event.body || "{}");
    const deviceId = validateDeviceId(body.deviceId);
    if (!deviceId) {
      metrics.record("ForgetRejection_InvalidDevice");
      writeForgetResult(responseStream, { ok: false, error: "Invalid request." });
      return;
    }
    if (tokenDeviceMismatch(auth, deviceId)) {
      // Erasure is destructive and irreversible, so a token naming a device it
      // was not minted for is refused outright rather than downgraded.
      metrics.record("MemoryDeviceMismatch");
      log.info("forget_device_mismatch");
      writeForgetResult(responseStream, { ok: false, error: "Invalid request." });
      return;
    }
    const { deleted } = await forgetDevice(docClient, QueryCommand, BatchWriteCommand, deviceId);
    metrics.record("MemoryForget");
    metrics.record("MemoryForgetDeleted", deleted);
    log.info("memory_forget", { deleted });
    writeForgetResult(responseStream, { ok: true, deleted });
  } catch (error) {
    const errName = error instanceof Error ? error.name : String(error);
    // forgetDevice attaches the confirmed-deletion count to whatever it throws
    // (withDeletedCount in memory.mjs). Rows it DID erase are erased whether or
    // not the pass finished, and MemoryForgetDeleted is how an operator sees an
    // erase draining a partition across retries rather than never starting.
    const partial = /** @type {{ deleted?: number } | null | undefined} */ (error)?.deleted;
    if (typeof partial === "number" && partial > 0) metrics.record("MemoryForgetDeleted", partial);
    // A throttled partition that gave up mid-erase is a different operational
    // problem from a dependency that never answered, and the visitor's next
    // /forget resumes from where this one stopped.
    const partialErase = errName === "PartialForgetError";
    log.error(partialErase ? "forget_incomplete" : "forget_error", {
      error: errName,
      message: error instanceof Error ? error.message : "",
      deleted: typeof partial === "number" ? partial : 0,
    });
    // Copy and ForgetFailure stay as they are: from the visitor's side a partial
    // erase is still "memory was not cleared", and the alarm should see both.
    metrics.record("ForgetFailure");
    writeForgetResult(responseStream, { ok: false, error: "Unable to clear memory right now." });
  } finally {
    await metrics.flush();
  }
}

// eslint-disable-next-line complexity -- streaming handler: CORS, health, auth, rate limit, session token, guardrail, agent orchestration, error mapping
export const handler = awslambda.streamifyResponse(async (event, responseStream, _context) => {
  if (event.requestContext?.http?.method === "OPTIONS") {
    responseStream.write("");
    responseStream.end();
    return;
  }

  // Health check (no auth required — used by post-deploy checks and monitoring)
  const healthMethod = event.requestContext?.http?.method;
  const healthPath = event.rawPath || event.requestContext?.http?.path || "/";
  if (healthMethod === "GET" && healthPath === "/health") {
    responseStream.write(JSON.stringify({ ok: true, service: "chat-stream", version: "1.0.0" }));
    responseStream.end();
    return;
  }

  const requestId = event.headers?.["x-request-id"] || randomUUID();
  const metrics = new MetricsCollector(cloudwatchClient, "TheChrisGrey/SiteMetrics");
  const log = createLogger(requestId, { service: "chat-stream" });
  const requestStart = Date.now();
  const clientIp = event.requestContext?.http?.sourceIp || "unknown";
  setRequestContext(requestId, "chat-stream", { method: event.requestContext?.http?.method, path: event.rawPath });

  // Accept EITHER a server-issued session token (new model) OR the legacy
  // request-body HMAC signature (transition window). See lambda-shared/requestAuth.
  const auth = authenticateRequest(event, {
    sessionKey: SESSION_TOKEN_KEY,
    scope: "chat",
    legacyKey: SIGNING_KEY,
  });
  if (!auth.valid) {
    metrics.record("AuthRejection");
    log.info("auth_rejected", { method: auth.method, reason: auth.error });
    addBreadcrumb("auth", "request_rejected", { method: auth.method, reason: auth.error });
    writeSystemMessage(responseStream, "Unable to process request.");
    await metrics.flush();
    await flushSentry();
    return;
  }
  addBreadcrumb("auth", "request_authenticated", { method: auth.method });
  // Watch the legacy path drain to zero before retiring the bundled HMAC key.
  metrics.record(auth.method === "token" ? "AuthSessionToken" : "AuthLegacySignature");

  const rawPath = event.rawPath || event.requestContext?.http?.path || "/";
  if (rawPath.endsWith("/forget")) {
    await handleForget(event, responseStream, requestId, metrics, { clientIp, auth });
    return;
  }

  // Set by each exit below so the end-of-request telemetry in `finally` reports
  // WHICH way the turn ended. Previously only the success and unhandled-error
  // paths recorded anything, so the latency series measured only turns that
  // succeeded and the product funnel could not represent a rejection at all.
  let outcome = "success";
  // Declared out here so the `finally` tail can qualify the product event: a turn
  // truncated at maxTokens, or cut short by agent.mjs's loop cap, reaches the
  // funnel as outcome "success" with no way to tell it from a complete answer.
  // agent.mjs already meters AgentStop_<reason>; this is the reporting half.
  /** @type {string|null} */
  let stopReason = null;
  try {
    log.info("request_start", { ip: clientIp.substring(0, 8) + "..." });

    const rateLimitStart = Date.now();
    const rateLimit = await checkRateLimit(docClient, UpdateCommand, {
      table: RATE_LIMIT_TABLE,
      ip: clientIp,
      maxRequests: CHAT_MAX_REQUESTS,
      windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
      ttlBuffer: RATE_LIMIT_WINDOW_SECONDS,
      requestId,
    });
    metrics.record("RateLimitLatency", Date.now() - rateLimitStart, "Milliseconds");
    addBreadcrumb("ratelimit", "rate_limit_checked", { allowed: rateLimit.allowed });

    if (!rateLimit.allowed) {
      metrics.record("RateLimitRejection");
      outcome = "rate_limited";
      writeSystemMessage(responseStream, "You've reached the message limit. Please try again in about an hour.");
      return;
    }

    let body;
    try {
      if (Buffer.byteLength(event.body || "{}", "utf8") > 65536) throw new Error("request_too_large");
      body = JSON.parse(event.body || "{}");
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_body");
    } catch {
      metrics.record("MalformedRequest");
      log.error("malformed_json");
      outcome = "invalid_input";
      writeSystemMessage(responseStream, "Invalid request format.");
      return;
    }
    const messages = body.messages || [];
    const pageContext = validatePageContext(body.pageContext);
    let deviceId = validateDeviceId(body.deviceId);
    // The client signals `firstMessage: true` on the first user message of a
    // new session so the system prompt can include a one-time welcome-back
    // acknowledgment for returning visitors (those with stored facts). Coerce
    // strictly to a boolean — anything other than literal `true` is treated as
    // false so a malformed/attacker-crafted body can't force the greeting.
    const firstMessage = body.firstMessage === true;

    if (tokenDeviceMismatch(auth, deviceId)) {
      // Fail SAFE rather than closed on the chat path: the client clears its
      // device id after a successful "forget" while still holding a cached
      // token, so a legitimate visitor can present a stale binding. Dropping the
      // device costs that turn its memory; rejecting would cost it the answer.
      metrics.record("MemoryDeviceMismatch");
      log.info("chat_device_mismatch");
      deviceId = null;
    }

    const validation = validateInput(messages);
    if (!validation.valid) {
      outcome = "invalid_input";
      writeSystemMessage(responseStream, validation.error);
      return;
    }

    const { history, latest } = toStrandsMessages(messages);
    if (!latest) {
      metrics.record("InvalidLatestMessage");
      outcome = "invalid_input";
      writeSystemMessage(responseStream, "Please send a message to start our conversation.");
      return;
    }

    const withinBudget = await checkCostBudget(docClient, UpdateCommand, {
      table: RATE_LIMIT_TABLE,
      service: "chat",
      hourly: 500,
      daily: 2000,
      requestId,
    });
    if (!withinBudget) {
      metrics.record("CostBudgetRejection");
      outcome = "rate_limited";
      writeSystemMessage(
        responseStream,
        "Alti has reached today's shared usage limit. Please try again later or use the contact page.",
      );
      return;
    }

    const latestQuery = getLatestUserMessage(messages) || latest;

    // Generative UI (render_ui) is gated to the dedicated /chat page only — never
    // the floating widget, which reports the host page's path. The system prompt
    // only advertises render_ui on that surface, matching the registered tools.
    // currentPage is already trailing-slash-normalized by validatePageContext, so
    // prod's "/chat/" resolves here as "/chat" (see normalizePath in validation.mjs).
    const surface = pageContext?.currentPage === "/chat" ? "page" : "widget";
    // Resolved BEFORE the memory load: the gen-ui branch returns above
    // buildSystemPrompt, the only consumer of facts, so loading them for that
    // turn pays a DynamoDB Query on the critical path and throws the result away.
    const isGenUi = surface === "page" && detectGenUiIntent(latestQuery);

    const loadFacts = async () => {
      if (!deviceId) {
        // Without this, "the client stopped sending deviceId" and "nobody is a
        // returning visitor" are the same shape in CloudWatch.
        metrics.record("MemoryReadSkipped_NoDevice");
        return [];
      }
      if (isGenUi) return [];
      const memStart = Date.now();
      try {
        // getFacts carries its own deadline and page cap (memory.mjs
        // GET_FACTS_TIMEOUT_MS / MAX_QUERY_PAGES); a second race here would only
        // make which TimeoutError wins nondeterministic.
        const loaded = await getFacts(docClient, QueryCommand, deviceId);
        metrics.record("MemoryFactsLoaded", loaded.length);
        return loaded;
      } catch (err) {
        metrics.record("MemoryLoadFailure");
        log.error("memory_load_failure", {
          error: err instanceof Error ? err.name : String(err),
          message: err instanceof Error ? err.message : "",
        });
        return [];
      } finally {
        // In `finally` so a slow-and-failing load still emits a latency sample —
        // recorded only on success, a degrading read looked like no traffic.
        metrics.record("MemoryLoadLatency", Date.now() - memStart, "Milliseconds");
      }
    };

    const loadContext = async () => {
      if (!latestQuery) return null;
      const biasedQuery =
        pageContext && pageContext.section !== "AI Chat" && pageContext.section !== "Home"
          ? `${pageContext.section}: ${latestQuery}`
          : latestQuery;
      return retrieveContext(agentClient, RetrieveCommand, biasedQuery, {
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        requestId,
        metrics,
        timeoutMs: 4000,
        numberOfResults: 5,
      });
    };

    // Independent: retrieval reads only the query and page context, never facts.
    // Run serially they stacked ~580ms of dead air ahead of the first token.
    // Both helpers swallow their own failures, so neither settlement can reject.
    const [facts, retrievedContext] = await Promise.all([loadFacts(), loadContext()]);

    // Explicit "gen-ui" command → deterministic visual answer: force the render_ui
    // tool on Opus and emit the block(s), bypassing the conversational agent. The
    // visitor asked for a visual, so we never leave it to the model's discretion.
    // Gated to the /chat surface (matches render_ui availability).
    if (isGenUi) {
      metrics.record("GenUiRequested");

      // A second, much tighter bucket on the SAME table (the prefix convention
      // blueprint uses). The 20/hr chat limit above prices every turn the same,
      // but this is the only branch that reaches Opus at 1500 maxTokens, so a
      // full 20 turns spent here costs a large multiple of 20 Haiku turns —
      // which thechrisgrey-bedrock-cost only reports after the spend.
      // Keyed on the device where there is one so a shared egress IP does not
      // spend one visitor's budget on another's; the IP is the fallback, and
      // also what an id-less caller is metered on.
      const genUiKey = deviceId ? hashDeviceId(deviceId) : clientIp;
      const genUiLimit = await checkRateLimit(docClient, UpdateCommand, {
        table: RATE_LIMIT_TABLE,
        ip: genUiKey,
        prefix: "genui-",
        maxRequests: GENUI_MAX_REQUESTS,
        windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
        ttlBuffer: RATE_LIMIT_WINDOW_SECONDS,
        requestId,
      });
      if (!genUiLimit.allowed) {
        metrics.record("GenUiRateLimitRejection");
        log.info("genui_rate_limited");
        outcome = "genui_rate_limited";
        writeSystemMessage(
          responseStream,
          "You've reached the limit for visual answers this hour. Ask me the same question without \"gen-ui\" and I'll answer it in words.",
        );
        return;
      }

      const genUiAbort = new AbortController();
      const genUiTimer = setTimeout(() => genUiAbort.abort(), GENUI_TIMEOUT_MS);
      const toolUseId = `genui-${requestId}`;
      // A non-streaming Opus call writes nothing for up to 20s, and the client
      // drops the typing indicator on the first output part — so without these
      // frames the visitor who explicitly asked for the heavier answer sits
      // behind an undifferentiated three-dot indicator. Same event kinds the
      // agent path emits for every other tool; no client change is required.
      emitEvent(responseStream, { kind: EVENT_KINDS.TOOL_INVOCATION, tool: "render_ui", toolUseId });
      /** @type {{ ok: boolean, blockCount?: number, guardrailIntervened?: boolean, error?: string }} */
      let genUiResult = { ok: false, error: "genui_failed" };
      try {
        genUiResult = await renderGenUi({
          bedrockClient: bedrockRuntimeClient,
          ConverseCommand,
          ApplyGuardrailCommand,
          guardrailId: GUARDRAIL_ID,
          guardrailVersion: GUARDRAIL_VERSION,
          userMessage: latestQuery,
          retrievedContext: retrievedContext || "",
          responseStream,
          metrics,
          requestId,
          abortSignal: genUiAbort.signal,
        });
      } finally {
        clearTimeout(genUiTimer);
        emitEvent(responseStream, {
          kind: EVENT_KINDS.TOOL_RESULT,
          tool: "render_ui",
          toolUseId,
          status: genUiResult.ok ? "success" : "error",
        });
      }
      if (!genUiResult.ok) {
        outcome = "genui_error";
        writeSystemMessage(
          responseStream,
          "I couldn't compose that visual just now. Try rephrasing, or ask me to describe it in words instead.",
        );
        return;
      }
      // A declined turn also returns ok:true — renderGenUi writes its own decline
      // copy, so the fallback above must stay suppressed — but reporting it to
      // the product funnel as a rendered visual would count a refusal as a
      // feature success and hide however often the branch is being blocked.
      outcome = genUiResult.guardrailIntervened ? "genui_blocked" : "genui";
      responseStream.end();
      return;
    }

    const systemPrompt = buildSystemPrompt(
      retrievedContext,
      pageContext,
      facts,
      surface,
      firstMessage,
      Boolean(PODCAST_KNOWLEDGE_BASE_ID),
    );

    if (!PODCAST_KNOWLEDGE_BASE_ID) {
      // Separates "search_podcast was never registered" from "registered but
      // never hit" — every other Podcast* metric is downstream of a registered
      // tool, so the unconfigured state emits no telemetry of its own.
      metrics.record("PodcastToolDisabled");
    }

    const tools = buildTools({
      responseStream,
      metrics,
      sanityClient,
      agentClient,
      RetrieveCommand,
      podcastKbId: PODCAST_KNOWLEDGE_BASE_ID,
      docClient,
      PutCommand,
      deviceId,
      // Seeds remember_fact's dedupe map with what this visitor has already
      // stored. Without it the map starts empty and only catches repeats inside
      // a single turn, so a fact the visitor shared last week costs another
      // DynamoDB write and another row competing for the readable 20.
      facts,
      surface,
      requestId,
    });

    const modelOptions = {
      modelId: MODEL_ID,
      region: REGION,
      guardrailId: GUARDRAIL_ID,
      guardrailVersion: GUARDRAIL_VERSION,
      maxTokens: 500,
      temperature: 0.6,
    };
    const model =
      bedrockRuntimeClient.provider === "cloudflare"
        ? new CloudflareModel({
            ...modelOptions,
            client: bedrockRuntimeClient,
            initialToolName:
              PODCAST_KNOWLEDGE_BASE_ID && requiresPodcastSearch(latestQuery) ? "search_podcast" : undefined,
          })
        : buildBedrockModel(modelOptions);

    const agent = buildAgent({
      model,
      tools,
      systemPrompt,
      messages: history,
      name: "Alti",
    });

    const agentStart = Date.now();
    const agentAbort = new AbortController();
    // The deadline flag, not the catch below, is what proves a timeout: the
    // Strands SDK composes `cancelSignal` into the same controller agent.cancel()
    // uses, catches its own CancelledError and RETURNS an AgentResult with
    // stopReason "cancelled" (sdk agent.js). Nothing is ever thrown, so keying
    // AgentTimeout off `errName === "AbortError"` left the metric — and the alarm
    // behind it — permanently at zero while truncated turns reported success.
    let agentDeadlineFired = false;
    const agentTimeout = setTimeout(() => {
      agentDeadlineFired = true;
      agentAbort.abort();
    }, AGENT_TIMEOUT_MS);

    let result;
    try {
      result = await streamAgentResponse({
        agent,
        userMessage: latest,
        responseStream,
        cancelSignal: agentAbort.signal,
        metrics,
      });
    } finally {
      clearTimeout(agentTimeout);
    }

    metrics.record("AgentInvocationLatency", Date.now() - agentStart, "Milliseconds");
    stopReason = result.stopReason;

    if (result.usage) {
      if (result.usage.inputTokens != null) metrics.record("BedrockInputTokens", result.usage.inputTokens);
      if (result.usage.outputTokens != null) metrics.record("BedrockOutputTokens", result.usage.outputTokens);
      log.info("token_usage", {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });
    }

    if (agentDeadlineFired) {
      metrics.record("AgentTimeout");
      log.info("agent_timeout", { hadText: result.hadText });
      outcome = "timeout";
      // Whatever streamed already stays on screen; the client renders a SYS
      // message after streamed text as its own bubble (chatEvents.ts).
      writeSystemMessage(responseStream, "The response is taking too long. Please try again.");
      return;
    }

    if (result.stopReason === "cancelled") {
      // Not the deadline, so this is agent.mjs's programmatic loop cap. Expected
      // and already handled downstream — counted so the two are distinguishable.
      metrics.record("AgentLoopCapped");
    }

    if (result.guardrailIntervened) {
      log.info("guardrail_intervened", { hadText: result.hadText });
      if (!result.hadText) {
        // The guardrail blocked before anything reached the visitor, so the
        // decline copy IS the answer. Keeps the GuardrailInterventionStream name
        // the /admin health panel (lambda/metrics/index.mjs) and the CloudWatch
        // dashboard already read.
        metrics.record("GuardrailInterventionStream");
        outcome = "guardrail";
        writeSystemMessage(
          responseStream,
          "I'm here to help you learn about Christian Perez and his work. I'm not able to help with that particular request. Is there something about his background or career I can help you with?",
        );
        return;
      }
      // Blocked AFTER clean chunks had already shipped: the answer on screen is
      // truncated mid-thought and, until now, nothing told the visitor or the
      // funnel. A SYS message would read as an error under text the visitor can
      // see, so mark the message instead — the client already accepts a guardrail
      // frame with any reason (src/utils/chatEvents.ts). Counted under its own
      // name so the two remediation shapes stay separable.
      metrics.record("GuardrailInterventionMidStream");
      outcome = "guardrail_mid_stream";
      emitEvent(responseStream, {
        kind: EVENT_KINDS.GUARDRAIL,
        reason: "mid_stream",
        stopReason: result.stopReason || "unknown",
      });
    }

    if (!result.hadText) {
      outcome = "empty_response";
      emitEvent(responseStream, {
        kind: EVENT_KINDS.GUARDRAIL,
        reason: "empty_response",
        stopReason: result.stopReason || "unknown",
      });
      writeSystemMessage(responseStream, "I couldn't put together a response just now. Mind rephrasing?");
      return;
    }

    log.info("request_complete", { totalMs: Date.now() - requestStart, stopReason: result.stopReason });
    responseStream.end();
  } catch (error) {
    const errName = error instanceof Error ? error.name : String(error);
    const errMsg = error instanceof Error ? error.message || "" : "";
    log.error("request_error", { error: errName, message: errMsg });

    switch (classifyError(error)) {
      case "abort_timeout":
        // Belt and braces: the SDK's cancelSignal path returns rather than
        // throws (handled above), so reaching here means some other awaited
        // dependency aborted.
        metrics.record("AgentTimeout");
        outcome = "timeout";
        writeSystemMessage(responseStream, "The response is taking too long. Please try again.");
        break;
      case "guardrail_prestream":
        log.info("guardrail_intervened_prestream");
        metrics.record("GuardrailInterventionPreStream");
        outcome = "guardrail";
        writeSystemMessage(
          responseStream,
          "I'm here to help you learn about Christian Perez and his work. I'm not able to help with that particular request. Is there something about his background or career I can help you with?",
        );
        break;
      case "throttled":
        metrics.record("BedrockThrottled");
        outcome = "throttled";
        writeSystemMessage(responseStream, "The service is currently busy. Please try again in a moment.");
        break;
      default:
        metrics.record("UnhandledError");
        outcome = "error";
        captureError(error, { handler: "chat-stream", path: event.rawPath });
        writeSystemMessage(responseStream, "I encountered an error processing your request. Please try again.");
        break;
    }
  } finally {
    // One end-of-request tail for EVERY exit above. Scattered per-branch flushes
    // meant nine of eleven exits recorded no latency, emitted no product event,
    // and never flushed Sentry or PostHog.
    const latencyMs = Date.now() - requestStart;
    metrics.record("TotalRequestLatency", latencyMs, "Milliseconds");
    captureProductEvent("ChatMessageSent", { outcome, latencyMs, stopReason: stopReason || "none" });
    try {
      await metrics.flush();
      await flushSentry();
      await flushProductAnalytics();
    } catch (flushError) {
      // A throw from `finally` REPLACES the return, so an unguarded telemetry
      // flush would turn an already-answered request into a failed invocation.
      // metrics/PostHog swallow their own errors; Sentry.flush does not.
      log.error("telemetry_flush_error", {
        error: flushError instanceof Error ? flushError.name : String(flushError),
      });
    }
  }
});
