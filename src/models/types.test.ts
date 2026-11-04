import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  CHOICE_VALUES,
  FREE_TEXT_MAX_LENGTH,
  SCORE_MAX,
  SCORE_MIN,
  SURVEY_SCALE_MAX,
  SURVEY_SCALE_MIN,
  TOTAL_QUESTIONS,
  type ApiResponse,
  type ChoiceValue,
} from "@/models/types";

describe("shared constants", () => {
  it("TOTAL_QUESTIONS is 20", () => {
    expect(TOTAL_QUESTIONS).toBe(20);
  });

  it("CHOICE_VALUES are the 0..4 likert strings", () => {
    expect(CHOICE_VALUES).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("survey scale bounds are 1..5", () => {
    expect(SURVEY_SCALE_MIN).toBe(1);
    expect(SURVEY_SCALE_MAX).toBe(5);
  });

  it("score bounds are 0..100", () => {
    expect(SCORE_MIN).toBe(0);
    expect(SCORE_MAX).toBe(100);
  });

  it("free text max length is 1000", () => {
    expect(FREE_TEXT_MAX_LENGTH).toBe(1000);
  });
});

describe("ApiResponse discriminated union", () => {
  it("narrows on ok flag", () => {
    const ok: ApiResponse<{ id: string }> = { ok: true, data: { id: "x" } };
    const err: ApiResponse<{ id: string }> = {
      ok: false,
      error: { code: "VALIDATION", message: "bad" },
    };
    expect(ok.ok ? ok.data.id : null).toBe("x");
    expect(err.ok ? null : err.error.code).toBe("VALIDATION");
  });
});

describe("fast-check wiring", () => {
  it("every generated choice is a valid ChoiceValue", () => {
    fc.assert(
      fc.property(fc.constantFrom(...CHOICE_VALUES), (choice: ChoiceValue) => {
        expect(CHOICE_VALUES.includes(choice)).toBe(true);
      }),
    );
  });
});
