// Browser walk-through of the whole product (Playwright, laptop + phone widths). Works with the offline model.
//   node e2e/web_flow.mjs http://localhost:8000 /tmp/shots
// Landing → create organization → setup assistant (invites someone by chat) → console → invite form → the person
// leaving joins → conversation with nothing connected (skip → upload doc + photo → talk → phone QR → finish) →
// admin signs back in → knowledge base → Ask → Teams → Settings & plan.
import { createRequire } from "node:module";
import fs from "node:fs";

const { chromium } = createRequire(import.meta.url)("playwright");
const [BASE = "http://localhost:8000", OUT = "/tmp/cloneflow-e2e"] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const errors = [];
const checks = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (ok, what) => checks.push(`${ok ? "PASS" : "FAIL"} ${what}`);
let n = 0;
const shot = (p, name) => p.screenshot({ path: `${OUT}/${String(++n).padStart(2, "0")}-${name}.png` });
async function page(w, h, mobile = false, tag = "laptop") {
  const c = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, permissions: ["microphone", "camera"] });
  await c.addInitScript(() => { try { localStorage.setItem("cf.muted", "1"); } catch {} });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(`${tag} pageerror ${e.message}`));
  p.on("console", (m) => m.type() === "error" && !/Failed to load resource|demo\.mp4/.test(m.text()) && errors.push(`${tag} console ${m.text()}`));
  p.on("response", (r) => {
    const expected = r.status() === 401 || (r.status() === 402 && /admin\/invite/.test(r.url()));
    if (r.url().includes("/api/") && r.status() >= 400 && !expected) errors.push(`${tag} HTTP ${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`);
  });
  return { c, p };
}
const api = (p, path) => p.evaluate(async (path) => (await fetch("/api" + path, { credentials: "include" })).json(), path);
const stamp = Date.now().toString(36);
const ADMIN = { org: "Harborview Clinic", name: "Grace Lin", email: `grace+${stamp}@harborview.example`, pw: "harbor-pass-1" };
const LEAVER = { name: "Omar Haddad", email: `omar+${stamp}@harborview.example`, pw: "omar-pass-123" };

// ---- landing (laptop + phone)
const { c, p } = await page(1440, 900);
await p.goto(BASE + "/");
await sleep(1500);
await shot(p, "landing");
const html = await p.content();
check(/Sign in to your organization/.test(html) && /Create your organization/.test(html), "landing: organization sign-in and sign-up");
check(!/\$\d|cost meter/i.test(html.replace(/<[^>]+>/g, " ")), "landing: no prices or internal cost");
await p.locator("#pricing").scrollIntoViewIfNeeded();
await sleep(800);
await shot(p, "landing-plans");
check(/Starter/.test(html) && /Growth/.test(html) && /Pro/.test(html), "landing: Starter, Growth, Pro plans");
await p.goto(BASE + "/download");
await sleep(800);
await shot(p, "download");
const m = await page(390, 844, true, "phone-landing");
await m.p.goto(BASE + "/");
await sleep(1500);
await shot(m.p, "landing-phone");
await m.c.close();

// ---- create the organization → setup assistant
await p.goto(BASE + "/signup");
await p.locator("#org").fill(ADMIN.org);
await p.locator("#name").fill(ADMIN.name);
await p.locator("#email").fill(ADMIN.email);
await p.locator("#password").fill(ADMIN.pw);
await p.locator("input[type=checkbox]").check();
await p.getByRole("button", { name: /Create organization/ }).click();
await p.waitForURL("**/setup", { timeout: 15000 });
await sleep(1500);
await shot(p, "setup-start");
const say = async (t) => {
  await p.getByLabel("Your reply").fill(t);
  await p.keyboard.press("Enter");
  await sleep(1800);
};
await say("We run three family clinics in Madison, primary care and pediatrics.");
await say("Vaccine storage rules, billing codes, and which supplier to call");
await say("The front desk and the nursing team");
await say("Microsoft 365, Outlook and Teams");
await shot(p, "setup-profile");
await say(`Yes: ${LEAVER.name}, ${LEAVER.email}, practice manager, leaves Dec 15`);
await shot(p, "setup-invited");
const inviteCode = await p.locator("code").first().innerText().catch(() => "");
check(/\/join\//.test(inviteCode), "setup: the assistant invited someone by chat");
await p.getByRole("button", { name: "Open my console" }).click();
await p.waitForURL("**/admin", { timeout: 15000 });
await sleep(1500);
await shot(p, "console");
const ov = await p.content();
check(/Tailored to Harborview Clinic/.test(ov), "console: tailored to what the admin said");
check(/Starter plan/.test(ov) && /1 of 3/.test(ov), "console: Starter plan, 1 of 3 people");

// ---- invite form (with "what to capture")
await p.getByRole("button", { name: "Invite someone who's leaving" }).first().click();
await p.locator("#inv-name").fill("Ruth Park");
await p.locator("#inv-email").fill(`ruth+${stamp}@harborview.example`);
await p.locator("#inv-focus").fill("the controlled-substance log and the month-end supply order");
await p.getByRole("button", { name: "Create invitation link" }).click();
await sleep(1200);
await shot(p, "invite-form");
check(/\/join\//.test(await p.locator("code").first().innerText()), "console: invitation link from the form");
await p.getByRole("button", { name: "Done" }).click();
await c.close();

// ---- the person leaving: nothing connected → show me
const e = await page(1440, 900, false, "employee");
await e.p.goto(inviteCode.replace(/^https?:\/\/[^/]+/, BASE));
await sleep(1200);
await shot(e.p, "join");
await e.p.locator("#password").fill(LEAVER.pw);
await e.p.getByRole("button", { name: /Start my handover/ }).click();
await e.p.waitForURL("**/session**", { timeout: 15000 });
await sleep(1500);
await e.p.getByRole("button", { name: "Let's begin" }).click();
await sleep(2000);
const typeAnswer = async (t, wait = 2500) => {
  await e.p.getByRole("button", { name: "Type instead" }).click();
  await e.p.getByLabel("Your answer").fill(t);
  await e.p.keyboard.press("Enter");
  await sleep(wait);
};
await typeAnswer("I'm the practice manager. I joined Harborview in 2016.");
await typeAnswer("Mostly scheduling, the vaccine fridge, and the supply orders.", 3000);
await shot(e.p, "connect");
await e.p.getByText("Skip — I'll show you instead").click();
await sleep(2500);
let s = await api(e.p, "/me/session");
check(s.stage === "open", `employee: skip goes to show-me (${s.stage})`);
await e.p.locator("input[type=file]").first().setInputFiles({ name: "vaccine_fridge.md", mimeType: "text/markdown",
  buffer: Buffer.from("# Vaccine fridge\n1. Log the temperature at 8am and 4pm\n2. If above 8°C call the supplier (ask for Dana)\nThe spare data logger is in the top drawer of the nurses' station.\n") });
await sleep(3500);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAQklEQVR4nO3PQQ0AIBDAsANpSEcbKg5A0yP3pM4O9HPO7c8BAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIEBjkAuvQAeMYs+o0AAAAAElFTkSuQmCC", "base64");
await e.p.locator("input[type=file]").first().setInputFiles({ name: "supply_shelf.png", mimeType: "image/png", buffer: png });
await sleep(3500);
await typeAnswer("The backup key for the controlled-substance cabinet is with the practice owner, never in the building.", 3000);
await shot(e.p, "after-uploads");
await e.p.getByRole("button", { name: "Show me something" }).click();
await sleep(400);
await e.p.getByRole("menuitem", { name: /Use your phone/ }).click();
await sleep(2500);
await shot(e.p, "phone-qr");
await e.p.keyboard.press("Escape");
await sleep(800);
await e.p.getByRole("button", { name: /I'm done/ }).click();
await sleep(4000);
s = await api(e.p, "/me/session");
check(s.stage === "done", `employee: finished (${s.stage})`);
await shot(e.p, "done");
const ph = await page(390, 844, true, "employee-phone");
await ph.c.addCookies(await e.c.cookies());
await ph.p.goto(BASE + "/session");
await sleep(2000);
await shot(ph.p, "session-phone");
await ph.c.close();
await e.c.close();

// ---- admin signs back in, knowledge base, Ask, Teams, Settings
const a = await page(1440, 900, false, "admin");
await a.p.goto(BASE + "/login");
await a.p.locator("#email").fill(ADMIN.email);
await a.p.getByRole("button", { name: "Continue" }).click();
await sleep(800);
check(new RegExp(`Sign in to ${ADMIN.org}`).test(await a.p.content()), "sign-in step 2 names the organization");
await a.p.locator("#password").fill(ADMIN.pw);
await a.p.getByRole("button", { name: "Sign in", exact: true }).click();
await a.p.waitForURL("**/admin**", { timeout: 15000 });
await sleep(1500);
await shot(a.p, "console-after");
await a.p.goto(BASE + "/admin/knowledge");
await sleep(1500);
await shot(a.p, "knowledge-base");
await a.p.goto(BASE + "/admin/ask");
await sleep(1200);
const box = a.p.locator("input[placeholder^='Ask'], textarea[placeholder^='Ask']").first();
for (const q of ["Who has the backup key for the controlled-substance cabinet?", "What's the guest wifi password?"]) {
  await box.fill(q);
  await a.p.keyboard.press("Enter");
  await sleep(2500);
}
await shot(a.p, "ask");
await a.p.goto(BASE + "/admin/teams");
await sleep(1000);
await shot(a.p, "teams");
await a.p.goto(BASE + "/admin/settings");
await sleep(1200);
await shot(a.p, "settings");
check(/Your plan/.test(await a.p.content()), "settings: plans with the current one marked");
const am = await page(390, 844, true, "admin-phone");
await am.c.addCookies(await a.c.cookies());
await am.p.goto(BASE + "/admin");
await sleep(1500);
await shot(am.p, "console-phone");
await am.p.goto(BASE + "/setup");
await sleep(1500);
await shot(am.p, "setup-phone");
await am.c.close();
await a.c.close();
await b.close();
console.log(checks.join("\n"));
console.log("ERRORS:", errors.length ? "\n" + errors.join("\n") : "none");
process.exit(checks.some((c) => c.startsWith("FAIL")) || errors.length ? 1 : 0);
