// Pure behaviour tests for the virtual-factory speech/chat helpers. No DOM, no
// speechSynthesis, no fetch: the coordinator is exercised with an injected fake.
import { describe, expect, it } from "vitest";
import {
  DEDUPE_WINDOW_MS, SpeechCoordinator, cueKey, isDuplicateCue, pickVoiceForLocale,
  sanitizeSpeechText, voiceProfileFor, type SpeechRuntime,
} from "./speech";
import { buildAiChatMessage, detectChatIntent, greetingText, parseAiReply } from "./chat";
import type { VirtualEmployee } from "./types";

interface Voice { lang: string; name: string }
const VOICES: Voice[] = [
  { lang: "en-GB", name: "English UK" },
  { lang: "vi-VN", name: "Vietnam" },
  { lang: "zh-CN", name: "China" },
  { lang: "fr-FR", name: "France" },
];

class FakeUtterance {
  onstart: (() => void) | null = null;
  onboundary: ((event: { charIndex: number }) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  voice: Voice | null = null;
  pitch = 1;
  rate = 1;
  volume = 1;
  constructor(public text: string, public lang = "") {}
}

function fakeRuntime(available = true) {
  const spoken: FakeUtterance[] = [];
  const runtime: SpeechRuntime = {
    available,
    getVoices: () => VOICES as unknown as SpeechSynthesisVoice[],
    createUtterance: (text) => new FakeUtterance(text) as unknown as SpeechSynthesisUtterance,
    speak: (utterance) => { spoken.push(utterance as unknown as FakeUtterance); },
    cancel: () => {},
    resume: () => {},
  };
  return { runtime, spoken };
}

const EMPLOYEE: VirtualEmployee = {
  id: "WMS-RECEIVING-VIRTUAL-01",
  name: "Nguyen Van A",
  domain: "wms",
  level: "SPECIALIST",
  mode: "ACTIVE_EXECUTOR",
  status: "BUSY",
  enabled: true,
  taskCounts: { OPEN: 7, WAITING_APPROVAL: 2, DONE: 11 },
};

describe("speech helpers", () => {
  it("picks exact BCP47 voice, then language prefix, then any installed voice", () => {
    expect(pickVoiceForLocale(VOICES, "zh-CN")?.name).toBe("China");
    expect(pickVoiceForLocale(VOICES, "en-US")?.name).toBe("English UK");
    expect(pickVoiceForLocale([{ lang: "de_DE" }], "zh-CN")?.lang).toBe("de_DE");
    expect(pickVoiceForLocale([{ lang: "ja-JP" }], "vi-VN")?.lang).toBe("ja-JP");
    expect(pickVoiceForLocale(VOICES, "vi-VN")?.name).toBe("Vietnam");
    expect(pickVoiceForLocale([], "en-US")).toBeNull();
  });

  it("speaks the localized line verbatim but strips unresolved placeholders", () => {
    expect(sanitizeSpeechText("Xin chào, tôi đang trực ca.")).toBe("Xin chào, tôi đang trực ca.");
    expect(sanitizeSpeechText("你好，我在岗。")).toBe("你好，我在岗。");
    expect(sanitizeSpeechText("{name} here —  {n}\t tasks")).toBe("here — tasks");
  });

  it("gives each employee a stable, natural pitch/rate", () => {
    const a = voiceProfileFor(EMPLOYEE.id);
    expect(a).toEqual(voiceProfileFor(EMPLOYEE.id));
    expect(a.pitch).toBeGreaterThanOrEqual(0.9);
    expect(a.pitch).toBeLessThanOrEqual(1.18);
    expect(a.rate).toBeGreaterThanOrEqual(0.94);
    expect(a.rate).toBeLessThanOrEqual(1.06);
    expect(a).not.toEqual(voiceProfileFor("MES-SMT-VIRTUAL-01"));
  });

  it("dedupes the same cue for the same employee inside the window", () => {
    const key = cueKey(EMPLOYEE.id, 42);
    const seen = new Map<string, number>([[key, 1000]]);
    expect(isDuplicateCue(key, seen, 1000 + DEDUPE_WINDOW_MS - 1)).toBe(true);
    expect(isDuplicateCue(key, seen, 1000 + DEDUPE_WINDOW_MS)).toBe(false);
    expect(isDuplicateCue(key, seen, 999)).toBe(false);
    expect(isDuplicateCue(cueKey(EMPLOYEE.id, 43), seen, 1001)).toBe(false);
  });
});

describe("SpeechCoordinator", () => {
  it("uses the exact text, explicit lang, chosen voice and per-employee profile", () => {
    const { runtime, spoken } = fakeRuntime();
    const coordinator = new SpeechCoordinator(runtime, () => 1000);
    coordinator.speak({ employeeId: EMPLOYEE.id, cueId: 10, text: "  {name} on shift  ", locale: "en-US", priority: "interactive" });
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe("on shift");
    expect(spoken[0].lang).toBe("en-GB");
    expect(spoken[0].voice?.name).toBe("English UK");
    expect(spoken[0].pitch).toBe(voiceProfileFor(EMPLOYEE.id).pitch);
  });

  it("does not enqueue a duplicate cue, and degrades silently without an API", () => {
    const { runtime, spoken } = fakeRuntime();
    const coordinator = new SpeechCoordinator(runtime, () => 1000);
    const first = coordinator.speak({ employeeId: EMPLOYEE.id, cueId: 10, text: "hello", locale: "en-US", priority: "interactive" });
    const duplicate = coordinator.speak({ employeeId: EMPLOYEE.id, cueId: 10, text: "hello", locale: "en-US", priority: "interactive" });
    expect(first.getTimeline().status).toBe("speaking");
    expect(duplicate.getTimeline().status).toBe("cancelled");
    expect(spoken).toHaveLength(1);
    const offline = new SpeechCoordinator(fakeRuntime(false).runtime, () => 1000);
    expect(offline.speak({ employeeId: EMPLOYEE.id, cueId: 11, text: "hello", locale: "en-US", priority: "interactive" }).getTimeline().status).toBe("unavailable");
  });

  it("starts viseme timing at the real start event and records boundaries", () => {
    const { runtime, spoken } = fakeRuntime();
    let clock = 1000;
    const coordinator = new SpeechCoordinator(runtime, () => clock);
    const handle = coordinator.speak({ employeeId: EMPLOYEE.id, cueId: 12, text: "two tasks open", locale: "en-US", priority: "background" });
    handle.subscribe(() => {});
    expect(handle.getTimeline().startedAt).toBeNull();
    clock = 1400;
    spoken[0].onstart?.();
    clock = 1600;
    spoken[0].onboundary?.({ charIndex: 4 });
    const timeline = handle.getTimeline();
    expect(timeline.status).toBe("speaking");
    expect(timeline.startedAt).toBe(1400);
    expect(timeline.boundaries).toEqual([{ charIndex: 4, at: 200 }]);
    clock = 2600;
    spoken[0].onend?.();
    expect(handle.getTimeline().status).toBe("ended");
  });

  it("lets a focused click cut off a background event", () => {
    const { runtime, spoken } = fakeRuntime();
    const coordinator = new SpeechCoordinator(runtime, () => 1000);
    const background = coordinator.speak({ employeeId: EMPLOYEE.id, cueId: 20, text: "2 new tasks", locale: "en-US", priority: "background" });
    coordinator.speak({ employeeId: EMPLOYEE.id, cueId: 21, text: "I'm on shift", locale: "en-US", priority: "interactive" });
    expect(background.getTimeline().status).toBe("cancelled");
    expect(spoken).toHaveLength(2);
    expect(spoken[1].text).toBe("I'm on shift");
  });
});

describe("context-grounded chat helpers", () => {
  it("routes greetings, tasks, approvals, done and fallback trilingually", () => {
    expect(detectChatIntent("hello there")).toBe("greeting");
    expect(detectChatIntent("Xin chào bạn")).toBe("greeting");
    expect(detectChatIntent("what are you doing?")).toBe("working");
    expect(detectChatIntent("có bao nhiêu việc?")).toBe("tasks");
    expect(detectChatIntent("审批卡住了吗")).toBe("approval");
    expect(detectChatIntent("how many done")).toBe("done");
    expect(detectChatIntent("blue shoes")).toBe("fallback");
  });

  it("builds the focus greeting from live counts and localizes it", () => {
    expect(greetingText(EMPLOYEE, "en-US")).toContain("2 tasks need your approval");
    expect(greetingText(EMPLOYEE, "zh-CN")).toContain("2");
    expect(greetingText({ ...EMPLOYEE, taskCounts: { OPEN: 3 } }, "vi-VN")).toContain("3 việc");
    expect(greetingText({ ...EMPLOYEE, taskCounts: {} }, "en-US")).toContain("station is clear");
  });

  it("packs the live profile into the existing backend chat call and parses its envelope", () => {
    const prompt = buildAiChatMessage(EMPLOYEE, "vi-VN", "bạn đang làm gì?");
    expect(prompt).toContain("LIVE_PROFILE:");
    expect(prompt).toContain("openTasks=7");
    expect(prompt).toContain("waitingApproval=2");
    expect(prompt).toContain("doneTasks=11");
    expect(prompt).toContain("HUMAN_MESSAGE: bạn đang làm gì?");
    expect(parseAiReply({ success: true, data: { reply: "  Tôi đang xử lý 7 việc.  " } })).toBe("Tôi đang xử lý 7 việc.");
    // Real backend shape (verified live 2026-11-23): reply is a message object.
    expect(parseAiReply({ data: { reply: { role: "assistant", content: "I have *7* open\n tasks." } } })).toBe("I have 7 open tasks.");
    expect(parseAiReply({ reply: "ok" })).toBe("ok");
    expect(parseAiReply({ data: {} })).toBeNull();
    expect(parseAiReply({ data: { reply: { role: "assistant" } } })).toBeNull();
  });
});
