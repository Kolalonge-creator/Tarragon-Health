/** P11 (spec 9.2): several result files are sent one at a time; one failure never stops the rest. */
import { noteForFile, sendResultFiles } from "./batch-upload";

const file = (name: string) => new File(["x"], name, { type: "image/jpeg" });

describe("noteForFile", () => {
  it("keeps a single file's note as typed, and sends nothing when there is none", () => {
    expect(noteForFile("  fasting sample ", 0, 1)).toBe("fasting sample");
    expect(noteForFile("   ", 0, 1)).toBeUndefined();
  });

  it("numbers the pages of a multi-file send and stays within 500 characters", () => {
    expect(noteForFile("", 1, 3)).toBe("Page 2 of 3.");
    expect(noteForFile("fasting", 0, 2)).toBe("Page 1 of 2. fasting");
    expect(noteForFile("x".repeat(500), 0, 2)!.length).toBe(500);
  });
});

describe("sendResultFiles", () => {
  it("sends every file in order, records refusals and network failures per file, and reports progress", async () => {
    const sent: string[] = [];
    const progress: number[] = [];
    const results = await sendResultFiles(
      [file("p1.jpg"), file("p2.jpg"), file("p3.jpg")],
      async (f) => {
        sent.push(f.name);
        if (f.name === "p1.jpg") return { error: "Too big" };
        if (f.name === "p2.jpg") throw new Error("offline");
        return { error: null };
      },
      (done) => progress.push(done),
    );
    expect(sent).toEqual(["p1.jpg", "p2.jpg", "p3.jpg"]);
    expect(progress).toEqual([1, 2, 3]);
    expect(results[0]).toEqual({ ok: false, error: "Too big" });
    expect(results[1]!.ok).toBe(false);
    expect(results[2]).toEqual({ ok: true });
  });
});
