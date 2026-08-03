import assert from "node:assert/strict";

import {
  MEDIA_VIDEO_EXCEPTION_LIMIT_MS,
  MEDIA_VIDEO_SHORT_LIMIT_MS,
  evaluateMediaVideoPolicy,
  type MediaVideoAuthorization,
} from "./media-video-policy.ts";

interface MatrixCase {
  name: string;
  durationMs: number;
  ordinal: number;
  authorizations: MediaVideoAuthorization[];
  accepted: boolean;
}

const matrix: MatrixCase[] = [
  {
    name: "first 10s without authorization",
    durationMs: 10_000,
    ordinal: 1,
    authorizations: [],
    accepted: true,
  },
  {
    name: "first 20s without authorization",
    durationMs: 20_000,
    ordinal: 1,
    authorizations: [],
    accepted: false,
  },
  {
    name: "first 31s without authorization",
    durationMs: 31_000,
    ordinal: 1,
    authorizations: [],
    accepted: false,
  },
  {
    name: "second 10s without authorization",
    durationMs: 10_000,
    ordinal: 2,
    authorizations: [],
    accepted: false,
  },
  {
    name: "second 10s authorized",
    durationMs: 10_000,
    ordinal: 2,
    authorizations: ["segundo_video_15s"],
    accepted: true,
  },
  {
    name: "first 20s with exception",
    durationMs: 20_000,
    ordinal: 1,
    authorizations: ["excepcion_30s"],
    accepted: true,
  },
  {
    name: "first 31s with exception",
    durationMs: 31_000,
    ordinal: 1,
    authorizations: ["excepcion_30s"],
    accepted: false,
  },
  {
    name: "second 20s with second authorization only",
    durationMs: 20_000,
    ordinal: 2,
    authorizations: ["segundo_video_15s"],
    accepted: false,
  },
  {
    name: "second 20s with both authorizations",
    durationMs: 20_000,
    ordinal: 2,
    authorizations: [
      "segundo_video_15s",
      "excepcion_30s",
    ],
    accepted: true,
  },
];

for (const testCase of matrix) {
  const result = evaluateMediaVideoPolicy({
    durationMs: testCase.durationMs,
    serverVideoOrdinal: testCase.ordinal,
    authorizations: testCase.authorizations,
  });

  assert.equal(
    result.accepted,
    testCase.accepted,
    testCase.name,
  );
}

assert.equal(MEDIA_VIDEO_SHORT_LIMIT_MS, 15_000);
assert.equal(MEDIA_VIDEO_EXCEPTION_LIMIT_MS, 30_000);

assert.equal(
  evaluateMediaVideoPolicy({
    durationMs: 31_000,
    serverVideoOrdinal: 2,
    authorizations: [
      "segundo_video_15s",
      "excepcion_30s",
    ],
  }).accepted,
  false,
  "31 seconds must always be rejected",
);

console.log(JSON.stringify({
  rows: ["MEDIA-010", "MEDIA-011", "MEDIA-012"],
  matrixCases: matrix.length,
  additionalAssertions: 3,
  result: "PASS",
}));
