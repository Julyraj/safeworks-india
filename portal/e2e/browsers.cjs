/* Pick the browser engine for the browser tests: BROWSER=chromium (default) or BROWSER=firefox.
   Firefox runs the stock Mozilla build through WebDriver BiDi (Playwright channel "moz-firefox"); give its path in
   FIREFOX_PATH. Options Firefox does not support (isMobile) are dropped, so phone screens are tested at phone size
   with touch, but without a mobile user agent. */
const pw = require("playwright");

const NAME = (process.env.BROWSER || "chromium").toLowerCase();

async function launchBrowser() {
  if (NAME === "firefox") {
    const browser = await pw.firefox.launch({ channel: "moz-firefox", executablePath: process.env.FIREFOX_PATH, headless: true });
    const orig = browser.newContext.bind(browser);
    browser.newContext = async (opts = {}) => {
      const o = { ...opts }; delete o.isMobile;
      const ctx = await orig(o);
      const origPage = ctx.newPage.bind(ctx);
      ctx.newPage = async () => { const p = await origPage(); patchFill(p); return p; };
      ctx.on("page", patchFill);
      return ctx;
    };
    return browser;
  }
  return pw.chromium.launch();
}

/* In stock Firefox over WebDriver BiDi, Playwright's fill() sets the value in a way React's change tracking ignores, so
   the form state stays empty (a real person typing is not affected: key-by-key typing works). Set the value through the
   element's native setter and send an input event, which React does see. */
let patched = false;
function patchFill(page) {
  if (patched) return;
  const proto = Object.getPrototypeOf(page.locator("body"));
  const original = proto.fill;
  proto.fill = async function (value, options) {
    const tag = await this.evaluate((el) => el.tagName.toLowerCase(), undefined, options).catch(() => "");
    if (tag !== "input" && tag !== "textarea") return original.call(this, value, options);
    await this.evaluate((el, v) => {
      const P = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(P, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, value, options);
  };
  patched = true;
}

module.exports = { launchBrowser, BROWSER: NAME };
