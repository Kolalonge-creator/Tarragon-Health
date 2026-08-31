"use client";

import { useActionState, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createRiskQuestionnaireConfigDraftAction,
  type SaveRiskQuestionnaireConfigState,
} from "./actions";

const CATEGORIES = [
  "lifestyle",
  "family_history",
  "pmh",
  "meds",
  "vaccination",
  "screening_history",
] as const;

const INPUT_TYPES = ["boolean", "single_select", "multi_select", "number", "text"] as const;

type QuestionOption = { value: string; label: string };

type Question = {
  key: string;
  category: (typeof CATEGORIES)[number];
  prompt: string;
  help_text?: string;
  input_type: (typeof INPUT_TYPES)[number];
  options?: QuestionOption[];
  required: boolean;
  min?: number;
  max?: number;
  max_length?: number;
  applicability?: unknown;
  order_index: number;
};

type ParsedConfig = {
  questions: Question[];
  conditions: unknown[];
};

function emptyQuestion(orderIndex: number): Question {
  return {
    key: "",
    category: "lifestyle",
    prompt: "",
    input_type: "boolean",
    required: false,
    order_index: orderIndex,
  };
}

function optionsToText(options: QuestionOption[] | undefined): string {
  return (options ?? []).map((o) => `${o.value}:${o.label}`).join("\n");
}

function textToOptions(text: string): QuestionOption[] | undefined {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return undefined;
  return lines.map((line) => {
    const [value, ...rest] = line.split(":");
    return { value: (value ?? "").trim(), label: (rest.join(":") || value || "").trim() };
  });
}

/**
 * A field-by-field editor for the question bank (spec 97.6/97.7's "friendlier
 * follow-up" to the original JSON textarea — see git history for why JSON
 * shipped first). Scoring rules (conditions: per-condition factors, branching
 * predicates, thresholds) stay JSON below — genuinely a different, harder
 * problem than a form-field editor, and this table's own engine has no
 * patient-facing renderer live yet regardless (risk_questionnaire_configs
 * ships unsigned, the old hardcoded risk-scoring.ts is still what patients
 * see), so there is no live behaviour this could get subtly wrong for a real
 * patient today. Produces the exact same configJson shape the server action
 * already validates — no server-side change needed.
 */
export function RiskQuestionnaireConfigEditor({ defaultConfigJson }: { defaultConfigJson: string }) {
  const [state, action, pending] = useActionState<SaveRiskQuestionnaireConfigState, FormData>(
    createRiskQuestionnaireConfigDraftAction,
    undefined
  );

  // defaultConfigJson is the server-supplied initial value only — parsed once via lazy
  // initial state. The parent page keys this component on the latest config row's id, so
  // a successful save (which inserts a new row and revalidates the route) remounts this
  // component fresh with the new default rather than needing an effect to re-sync state.
  const [initial] = useState<{ questions: Question[]; conditionsJson: string; parseError: string | null }>(
    () => {
      try {
        const parsed = JSON.parse(defaultConfigJson) as ParsedConfig;
        return {
          questions: Array.isArray(parsed.questions) ? parsed.questions : [],
          conditionsJson: JSON.stringify(parsed.conditions ?? [], null, 2),
          parseError: null,
        };
      } catch {
        return {
          questions: [],
          conditionsJson: "[]",
          parseError: "Could not parse the current configuration as JSON — falling back is not available.",
        };
      }
    }
  );
  const [questions, setQuestions] = useState<Question[]>(initial.questions);
  const [conditionsJson, setConditionsJson] = useState(initial.conditionsJson);
  const [optionsDraft, setOptionsDraft] = useState<Record<number, string>>({});
  const parseError = initial.parseError;

  function updateQuestion(index: number, patch: Partial<Question>) {
    setQuestions((qs) => qs.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  function moveQuestion(index: number, direction: -1 | 1) {
    setQuestions((qs) => {
      const target = index + direction;
      if (target < 0 || target >= qs.length) return qs;
      const next = [...qs];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((q, i) => ({ ...q, order_index: i }));
    });
  }

  function removeQuestion(index: number) {
    setQuestions((qs) => qs.filter((_, i) => i !== index).map((q, i) => ({ ...q, order_index: i })));
  }

  function addQuestion() {
    setQuestions((qs) => [...qs, emptyQuestion(qs.length)]);
  }

  let conditionsParsed: unknown[] | null = null;
  let conditionsError: string | null = null;
  try {
    const parsed = JSON.parse(conditionsJson);
    if (!Array.isArray(parsed)) throw new Error("conditions must be a JSON array");
    conditionsParsed = parsed;
  } catch (e) {
    conditionsError = e instanceof Error ? e.message : "Invalid JSON";
  }

  const configJson = JSON.stringify({
    questions,
    conditions: conditionsParsed ?? [],
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New version</CardTitle>
        <CardDescription>
          Edit the questions and/or scoring rules below, then save as a new draft version. It
          will not affect the live risk assessment until a Clinical Director signs it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {parseError && <p className="mb-3 text-sm text-red-600">{parseError}</p>}
        <form action={action} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="notes">What changed, and why</Label>
            <Textarea
              id="notes"
              name="notes"
              required
              maxLength={2000}
              placeholder="e.g. Added a CKD risk domain per the nephrology protocol review."
            />
          </div>

          <div className="space-y-3">
            <Label>Questions</Label>
            <ul className="space-y-3">
              {questions.map((q, i) => (
                <li key={i} className="space-y-2 rounded-md border border-charcoal-ink/15 p-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1">
                      <Label htmlFor={`q_key_${i}`} className="text-xs">Key</Label>
                      <Input
                        id={`q_key_${i}`}
                        value={q.key}
                        onChange={(e) => updateQuestion(i, { key: e.target.value })}
                        className="w-36 font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`q_category_${i}`} className="text-xs">Category</Label>
                      <Select
                        id={`q_category_${i}`}
                        value={q.category}
                        onChange={(e) =>
                          updateQuestion(i, { category: e.target.value as Question["category"] })
                        }
                        className="h-9 w-40 text-xs"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`q_input_type_${i}`} className="text-xs">Answer type</Label>
                      <Select
                        id={`q_input_type_${i}`}
                        value={q.input_type}
                        onChange={(e) =>
                          updateQuestion(i, { input_type: e.target.value as Question["input_type"] })
                        }
                        className="h-9 w-36 text-xs"
                      >
                        {INPUT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <label className="flex items-center gap-1.5 pb-2 text-xs">
                      <input
                        type="checkbox"
                        checked={q.required}
                        onChange={(e) => updateQuestion(i, { required: e.target.checked })}
                      />
                      Required
                    </label>
                    <div className="ml-auto flex items-center gap-1">
                      <Button type="button" size="sm" variant="outline" onClick={() => moveQuestion(i, -1)} disabled={i === 0}>
                        ↑
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => moveQuestion(i, 1)} disabled={i === questions.length - 1}>
                        ↓
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => removeQuestion(i)}>
                        Remove
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`q_prompt_${i}`} className="text-xs">Prompt</Label>
                    <Input
                      id={`q_prompt_${i}`}
                      value={q.prompt}
                      onChange={(e) => updateQuestion(i, { prompt: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`q_help_${i}`} className="text-xs">Help text (optional)</Label>
                    <Input
                      id={`q_help_${i}`}
                      value={q.help_text ?? ""}
                      onChange={(e) => updateQuestion(i, { help_text: e.target.value || undefined })}
                    />
                  </div>
                  {(q.input_type === "single_select" || q.input_type === "multi_select") && (
                    <div className="space-y-1">
                      <Label htmlFor={`q_options_${i}`} className="text-xs">
                        Options — one per line, <code>value:label</code>
                      </Label>
                      <Textarea
                        id={`q_options_${i}`}
                        rows={3}
                        className="font-mono text-xs"
                        value={optionsDraft[i] ?? optionsToText(q.options)}
                        onChange={(e) => {
                          setOptionsDraft((d) => ({ ...d, [i]: e.target.value }));
                          updateQuestion(i, { options: textToOptions(e.target.value) });
                        }}
                      />
                    </div>
                  )}
                  {q.input_type === "number" && (
                    <div className="flex gap-3">
                      <div className="space-y-1">
                        <Label htmlFor={`q_min_${i}`} className="text-xs">Min (optional)</Label>
                        <Input
                          id={`q_min_${i}`}
                          type="number"
                          value={q.min ?? ""}
                          onChange={(e) =>
                            updateQuestion(i, { min: e.target.value ? Number(e.target.value) : undefined })
                          }
                          className="w-24"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`q_max_${i}`} className="text-xs">Max (optional)</Label>
                        <Input
                          id={`q_max_${i}`}
                          type="number"
                          value={q.max ?? ""}
                          onChange={(e) =>
                            updateQuestion(i, { max: e.target.value ? Number(e.target.value) : undefined })
                          }
                          className="w-24"
                        />
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <Button type="button" size="sm" variant="outline" onClick={addQuestion}>
              Add question
            </Button>
          </div>

          <div className="space-y-1">
            <Label htmlFor="conditionsJson">
              Scoring rules (JSON) — per-condition factors, thresholds, and branching predicates.
              Not yet a structured editor; validated the same way on save.
            </Label>
            <Textarea
              id="conditionsJson"
              rows={14}
              className="font-mono text-xs"
              value={conditionsJson}
              onChange={(e) => setConditionsJson(e.target.value)}
            />
            {conditionsError && <p className="text-xs text-red-600">{conditionsError}</p>}
          </div>

          <input type="hidden" name="configJson" value={configJson} />
          <Button type="submit" disabled={pending || Boolean(conditionsError)}>
            {pending ? "Saving…" : "Save as new draft version"}
          </Button>
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && (
            <p className="text-sm text-brand-green">Saved as a new draft — sign it below to bring it into force.</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
