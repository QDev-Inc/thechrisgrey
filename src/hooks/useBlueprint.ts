import { useCallback, useRef, useState } from 'react';
import { getSessionToken } from '../utils/sessionToken';
import { getOrCreateDeviceId } from '../utils/deviceId';
import { withTraceId } from '../utils/traceId';
import { getFeatureFlag } from '../utils/featureFlags';
import type { BlueprintInput, BlueprintOutput, BlueprintResponse, BlueprintSuccessResponse } from '../types/blueprint';

const BLUEPRINT_ENDPOINT = getFeatureFlag('blueprintEndpoint');
const REQUEST_TIMEOUT_MS = 110_000; // Allow the 100-second Lambda to return its terminal event.

export type BlueprintErrorKind =
  | 'rate_limited'
  | 'timeout'
  | 'validation_failed'
  | 'generation_failed'
  | 'invalid_input'
  | 'invalid_device_id'
  | 'unauthorized'
  | 'network'
  | 'not_configured'
  | 'unknown';

export interface BlueprintError {
  kind: BlueprintErrorKind;
  message: string;
  details?: unknown;
}

export interface UseBlueprintState {
  output: BlueprintOutput | null;
  meta: BlueprintSuccessResponse['meta'] | null;
  isGenerating: boolean;
  error: BlueprintError | null;
}

export interface UseBlueprintReturn extends UseBlueprintState {
  generate: (input: BlueprintInput) => Promise<void>;
  reset: () => void;
}

function classifyError(res: Response, body: BlueprintResponse | null): BlueprintError {
  const errorCode = body && !body.ok && 'error' in body ? (body as { error?: string }).error : undefined;
  const message = (body && !body.ok && 'message' in body && (body as { message?: string }).message) || undefined;

  switch (res.status) {
    case 429:
      return {
        kind: 'rate_limited',
        message:
          message ||
          "You've generated your blueprint for this 30-day window. Join the waitlist for higher-limit Pro access.",
      };
    case 401:
      return {
        kind: 'unauthorized',
        message: 'The request could not be authorized. Please refresh and try again.',
      };
    case 400:
      if (errorCode === 'invalid_device_id') {
        return {
          kind: 'invalid_device_id',
          message: 'Your browser session is missing an identifier. Refresh the page and try again.',
        };
      }
      return {
        kind: 'invalid_input',
        message: message || 'Please review your spec — a field failed validation.',
        details: body && !body.ok ? (body as { details?: unknown }).details : undefined,
      };
    case 502:
      return {
        kind: 'validation_failed',
        message: message || "The model returned a blueprint that didn't meet our quality bar. Please try again.",
      };
    case 504:
      return {
        kind: 'timeout',
        message: message || 'Generation took too long. Please try again.',
      };
    default:
      return {
        kind: 'generation_failed',
        message: message || 'Something went wrong. Please try again.',
      };
  }
}

export function useBlueprint(): UseBlueprintReturn {
  const [output, setOutput] = useState<BlueprintOutput | null>(null);
  const [meta, setMeta] = useState<BlueprintSuccessResponse['meta'] | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<BlueprintError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setOutput(null);
    setMeta(null);
    setError(null);
    setIsGenerating(false);
  }, []);

  const generate = useCallback(async (input: BlueprintInput) => {
    if (!BLUEPRINT_ENDPOINT) {
      setError({
        kind: 'not_configured',
        message: 'Blueprint endpoint not configured. Set VITE_BLUEPRINT_ENDPOINT in your environment.',
      });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    setIsGenerating(true);
    setError(null);
    setOutput(null);
    setMeta(null);

    const deviceId = getOrCreateDeviceId();
    const body = JSON.stringify({ spec: input, deviceId });

    try {
      const token = await getSessionToken('blueprint');
      const response = await fetch(
        BLUEPRINT_ENDPOINT,
        withTraceId({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body,
          signal: controller.signal,
        }),
      );

      let parsed: BlueprintResponse | null = null;
      try {
        parsed = (await response.json()) as BlueprintResponse;
      } catch {
        parsed = null;
      }

      if (!response.ok) {
        setError(classifyError(response, parsed));
        return;
      }

      if (!parsed || !('ok' in parsed) || parsed.ok !== true) {
        setError({
          kind: 'unknown',
          message: 'Unexpected response shape from the blueprint service.',
        });
        return;
      }

      setOutput(parsed.output);
      setMeta(parsed.meta);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setError({
          kind: 'timeout',
          message: 'Generation took longer than expected. The model may still be warming up — please try again.',
        });
      } else {
        setError({
          kind: 'network',
          message: "We couldn't reach the blueprint service. Check your connection and try again.",
        });
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setIsGenerating(false);
    }
  }, []);

  return { output, meta, isGenerating, error, generate, reset };
}
