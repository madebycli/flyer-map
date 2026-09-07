import assert from "node:assert/strict";
import test from "node:test";
import { resolveRemoteReadState } from "../src/collaboration/remoteReadState.ts";

test("remote read UX distinguishes loading, schema/error, empty and data states", () => {
  assert.equal(
    resolveRemoteReadState({ loading: true, error: null, itemCount: 0 }),
    "loading",
  );
  assert.equal(
    resolveRemoteReadState({ loading: false, error: "Migration 0007 fehlt", itemCount: 0 }),
    "error",
  );
  assert.equal(
    resolveRemoteReadState({ loading: false, error: null, itemCount: 0 }),
    "empty",
  );
  assert.equal(
    resolveRemoteReadState({ loading: false, error: null, itemCount: 3 }),
    "data",
  );
});

test("already loaded data stays visible during refresh or transient read failure", () => {
  assert.equal(
    resolveRemoteReadState({ loading: true, error: null, itemCount: 4 }),
    "data",
  );
  assert.equal(
    resolveRemoteReadState({ loading: false, error: "Netzwerkfehler", itemCount: 4 }),
    "data",
  );
});

test("an error without loaded data never degrades into a false empty state", () => {
  for (const message of [
    "field_group_schema_unavailable",
    "field_session_schema_unavailable",
    "comment_schema_unavailable",
    "activity_schema_unavailable",
    "automation_schema_unavailable",
    "401",
    "403",
    "network_error",
  ]) {
    assert.notEqual(
      resolveRemoteReadState({ loading: false, error: message, itemCount: 0 }),
      "empty",
    );
  }
});
