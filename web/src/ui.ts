// DOM builders for the first-five-minutes flow (§4.2). No framework, no game logic: every
// string and every decision about WHAT to show is decided in flow.ts/viewmodel.ts/main.ts —
// this file only creates and wires DOM nodes. Not unit-tested (DOM-dependent); keep it
// mechanical so main.ts stays the only place with sequencing decisions.
import type { UtilityKey } from "../../src/schema/core.js";
import type { WhyCard } from "./viewmodel.js";

function requireEl(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`ui.ts: #${id} missing from index.html`);
  return el;
}

function clear(el: HTMLElement): void {
  el.replaceChildren();
}

/** §4.2 0:00–0:20 register: 名字 / 血脉 / 当前目标 / 一句风险. Blocking card, dismissable. */
export function showOpeningCard(
  name: string,
  lineageName: string,
  goalLine: string,
  riskLine: string,
  onDismiss: () => void,
): void {
  const root = requireEl("flow-overlay");
  clear(root);

  const card = document.createElement("div");
  card.className = "card opening-card";

  const title = document.createElement("h2");
  title.textContent = name;
  card.appendChild(title);

  const lineage = document.createElement("p");
  lineage.textContent = `血脉：${lineageName}`;
  card.appendChild(lineage);

  const goal = document.createElement("p");
  goal.textContent = goalLine;
  card.appendChild(goal);

  const risk = document.createElement("p");
  risk.className = "risk";
  risk.textContent = riskLine;
  card.appendChild(risk);

  const btn = document.createElement("button");
  btn.textContent = "跟随他";
  btn.addEventListener("click", () => {
    clear(root);
    onDismiss();
  });
  card.appendChild(btn);

  root.appendChild(card);
}

/** §4.2 0:20–1:00: a persistent small button that opens the why-card on demand. Created once. */
export function showWhyButton(onClick: () => void): void {
  const root = requireEl("why-slot");
  clear(root);
  const btn = document.createElement("button");
  btn.textContent = "他为什么这么做？";
  btn.addEventListener("click", onClick);
  root.appendChild(btn);
}

/** Dismissable panel rendering a WhyCard (structured audit data only — no LLM). */
export function renderWhyCard(card: WhyCard, onClose: () => void): void {
  const root = requireEl("flow-overlay");
  clear(root);

  const el = document.createElement("div");
  el.className = "card why-card";

  const title = document.createElement("h2");
  title.textContent = card.title;
  el.appendChild(title);

  const need = document.createElement("p");
  need.textContent = card.need;
  el.appendChild(need);

  if (card.personality.length > 0) {
    const list = document.createElement("ul");
    for (const trait of card.personality) {
      const li = document.createElement("li");
      li.textContent = trait;
      list.appendChild(li);
    }
    el.appendChild(list);
  }

  if (card.experience.length > 0) {
    const list = document.createElement("ul");
    for (const line of card.experience) {
      const li = document.createElement("li");
      li.textContent = line;
      list.appendChild(li);
    }
    el.appendChild(list);
  }

  if (card.candidates.length > 0) {
    const table = document.createElement("table");
    table.className = "candidates";
    for (const c of card.candidates) {
      const row = document.createElement("tr");
      if (c.chosen) row.className = "chosen";
      const label = document.createElement("td");
      label.textContent = c.chosen ? `▶ ${c.label}` : c.label;
      const score = document.createElement("td");
      score.textContent = String(c.score);
      row.appendChild(label);
      row.appendChild(score);
      table.appendChild(row);
    }
    el.appendChild(table);
  }

  const source = document.createElement("p");
  source.className = "source-line";
  source.textContent = card.sourceLine;
  el.appendChild(source);

  const btn = document.createElement("button");
  btn.className = "close-btn";
  btn.textContent = "关闭";
  btn.addEventListener("click", () => {
    clear(root);
    onClose();
  });
  el.appendChild(btn);

  root.appendChild(el);
}

const THEME_BUTTONS: { key: UtilityKey; label: string }[] = [
  { key: "explore", label: "探索" },
  { key: "seekMate", label: "关系" },
  { key: "forage", label: "储备" },
  { key: "shelter", label: "建造" },
];

/** §4.1 守望 theme selection. Four buttons + the honesty line — this is never a command. */
export function showPatronCard(onChoose: (theme: UtilityKey) => void): void {
  const root = requireEl("flow-overlay");
  clear(root);

  const card = document.createElement("div");
  card.className = "card patron-card";

  const title = document.createElement("h2");
  title.textContent = "你的守望，会倾向哪个方向？";
  card.appendChild(title);

  const buttons = document.createElement("div");
  buttons.className = "theme-buttons";
  for (const { key, label } of THEME_BUTTONS) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.addEventListener("click", () => {
      clear(root);
      onChoose(key);
    });
    buttons.appendChild(btn);
  }
  card.appendChild(buttons);

  const honesty = document.createElement("p");
  honesty.className = "honesty-line";
  honesty.textContent = "这不是命令，只会在它犹豫时形成轻微影响";
  card.appendChild(honesty);

  root.appendChild(card);
}

/** Appends new lines to the running event feed, capped so the DOM doesn't grow unbounded. */
export function renderEventFeed(lines: string[]): void {
  if (lines.length === 0) return;
  const root = requireEl("events") as HTMLUListElement;
  for (const line of lines) {
    const li = document.createElement("li");
    li.textContent = line;
    root.appendChild(li);
  }
  while (root.childElementCount > 200) {
    root.removeChild(root.firstChild!);
  }
  root.scrollTop = root.scrollHeight;
}

/** 接下来值得看 panel — full rebuild each call from flow.hooks (already capped/ordered). */
export function renderHooks(hooks: string[]): void {
  const root = requireEl("hooks-panel");
  clear(root);
  if (hooks.length === 0) return;

  const title = document.createElement("h3");
  title.textContent = "接下来值得看";
  root.appendChild(title);

  const list = document.createElement("ul");
  for (const line of hooks) {
    const li = document.createElement("li");
    li.textContent = line;
    list.appendChild(li);
  }
  root.appendChild(list);
}

/** Shown once, when the flow reaches "living": the return hook + the always-true closing
 * line that the world keeps running whether or not the player is watching. */
export function showReturnHook(line: string): void {
  const root = requireEl("return-hook-panel");
  clear(root);

  const hook = document.createElement("p");
  hook.textContent = line;
  root.appendChild(hook);

  const closing = document.createElement("p");
  closing.className = "closing-line";
  closing.textContent = "世界不会因你离线暂停——他们会继续生活、繁衍，也可能死去。";
  root.appendChild(closing);
}

/** 血脉传记 button, available from beat "living". Created once. */
export function showBiographyButton(onClick: () => void): void {
  const root = requireEl("biography-slot");
  clear(root);
  const btn = document.createElement("button");
  btn.id = "biography-btn";
  btn.textContent = "血脉传记";
  btn.addEventListener("click", onClick);
  root.appendChild(btn);
}

/** §4.4: mark the biography button after the followed NPC dies — cause chain is already in
 * the feed line; this is an invitation to read the fuller record, not a punishment cue. */
export function highlightBiographyButton(): void {
  const btn = document.getElementById("biography-btn");
  if (btn !== null) btn.classList.add("highlight");
}

/** Modal rendering renderBiography(...) output verbatim in a <pre>. */
export function showBiography(text: string): void {
  const root = requireEl("biography-modal") as HTMLDivElement;
  clear(root);
  root.hidden = false;

  const modal = document.createElement("div");
  modal.className = "modal-card";

  const pre = document.createElement("pre");
  pre.textContent = text;
  modal.appendChild(pre);

  const btn = document.createElement("button");
  btn.textContent = "关闭";
  btn.addEventListener("click", () => {
    root.hidden = true;
    clear(root);
  });
  modal.appendChild(btn);

  root.appendChild(modal);
}
