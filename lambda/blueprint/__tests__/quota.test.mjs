import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createBlueprintQuota } from "../quota.mjs";

class UpdateCommand {
  constructor(input) {
    this.input = input;
  }
}
const options = { table: "test-quota", deviceHash: "device", requestId: "request", now: 1800000000000 };
const conditionalFailure = () => Object.assign(new Error("conflict"), { name: "ConditionalCheckFailedException" });

test("the reservation outlives the Lambda and the browser waits for the Lambda deadline", async () => {
  const template = readFileSync(new URL("../../../infra/personal-account-services.yaml", import.meta.url), "utf8");
  const blueprint = template.split("  BlueprintFunction:")[1].split("  KbBuilderFunction:")[0];
  const lambdaSeconds = Number(blueprint.match(/Timeout: (\d+)/)[1]);
  const frontend = readFileSync(new URL("../../../src/hooks/useBlueprint.ts", import.meta.url), "utf8");
  const browserSeconds = Number(frontend.match(/REQUEST_TIMEOUT_MS = ([\d_]+)/)[1].replaceAll("_", "")) / 1000;
  let leaseSeconds = 0;
  const quota = createBlueprintQuota(
    {
      send: async ({ input }) => {
        leaseSeconds = input.ExpressionAttributeValues[":lease"] - input.ExpressionAttributeValues[":now"];
      },
    },
    UpdateCommand,
    options,
  );
  await quota.reserve();
  assert.ok(leaseSeconds >= lambdaSeconds + 10, "a new request must not overlap a still-running generation");
  assert.ok(browserSeconds >= lambdaSeconds + 5, "the browser must receive the terminal event before aborting");
});

test("successful generation commits one allowance and does not release it", async () => {
  const calls = [];
  const quota = createBlueprintQuota(
    {
      send: async (command) => {
        calls.push(command.input);
      },
    },
    UpdateCommand,
    options,
  );
  assert.deepEqual(await quota.reserve(), { allowed: true, unavailable: false });
  await quota.commit();
  await quota.release();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].ExpressionAttributeValues[":one"], 1);
  assert.equal(calls[0].ExpressionAttributeValues[":owner"], calls[1].ExpressionAttributeValues[":owner"]);
});

test("failed generation releases only its own reservation without spending the allowance", async () => {
  const calls = [];
  const quota = createBlueprintQuota(
    {
      send: async (command) => {
        calls.push(command.input);
      },
    },
    UpdateCommand,
    options,
  );
  await quota.reserve();
  await quota.release();
  await quota.release();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].UpdateExpression, "REMOVE leaseOwner, leaseUntil");
  assert.match(calls[1].ConditionExpression, /leaseOwner = :owner/);
});

test("an occupied or spent allowance does not create a releasable reservation", async () => {
  let calls = 0;
  const quota = createBlueprintQuota(
    {
      send: async () => {
        calls++;
        throw conditionalFailure();
      },
    },
    UpdateCommand,
    options,
  );
  assert.deepEqual(await quota.reserve(), { allowed: false, unavailable: false });
  await quota.release();
  assert.equal(calls, 1);
});

test("storage failures deny a reservation and a failed commit remains releasable", async () => {
  const unavailable = createBlueprintQuota(
    {
      send: async () => {
        throw new Error("offline");
      },
    },
    UpdateCommand,
    options,
  );
  assert.deepEqual(await unavailable.reserve(), { allowed: false, unavailable: true });
  let calls = 0;
  const quota = createBlueprintQuota(
    {
      send: async () => {
        if (++calls === 2) throw new Error("offline");
      },
    },
    UpdateCommand,
    options,
  );
  await quota.reserve();
  await assert.rejects(quota.commit(), /offline/);
  await quota.release();
  assert.equal(calls, 3);
});

test("a failed release is bounded and leaves the lease to expire", async () => {
  let calls = 0;
  const quota = createBlueprintQuota(
    {
      send: async () => {
        if (++calls > 1) throw new Error("offline");
      },
    },
    UpdateCommand,
    options,
  );
  await quota.reserve();
  await quota.release();
  assert.equal(calls, 2);
});
