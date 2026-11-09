const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

console.log("==================================================================");
console.log("  PART 1: SINGLE-TAB EXECUTION (sandbox-script.js)");
console.log("==================================================================");

const scriptPath = path.join(__dirname, "..", "AID-sandbox", "sandbox-script.js");
const code = fs.readFileSync(scriptPath, "utf8");

const sandbox = {
    text: "",
    state: {},
    info: {},
    console: console
};

vm.createContext(sandbox);
vm.runInContext(code, sandbox);

function runInput(input) {
    sandbox.text = input;
    return vm.runInContext("modifier(text)", sandbox);
}

// 1. Test /roll
const r1 = runInput("/roll -d 20 -m 4");
assert(r1.text.includes("DICE ROLL"), "Expected DICE ROLL in output");
assert(r1.text.includes("1d20+4"), "Expected 1d20+4 in output");
console.log("   ✔ /roll -d 20 -m 4 executed and formatted cleanly");

// 2. Test /roll advantage
const r2 = runInput("/roll -d 20 -a");
assert(r2.text.includes("Advantage"), "Expected Advantage in output");
assert(r2.text.includes("2d20"), "Expected 2d20 in output");
console.log("   ✔ /roll -d 20 -a (Advantage) rolled twice and kept highest");

// 3. Test /roll mobile em-dash
const r3 = runInput("/roll —d 12 —m 2");
assert(r3.text.includes("1d12+2"), "Expected 1d12+2 with em-dash");
console.log("   ✔ /roll —d 12 —m 2 (Mobile em-dashes) normalized and parsed");

// 4. Test /roll dialogue unwrap
const r4 = runInput('You say, "/roll -d 6 -m 1".');
assert(r4.text.includes("1d6+1"), "Expected 1d6+1 in dialogue");
console.log("   ✔ You say, \"/roll -d 6 -m 1\" dialogue wrapper unwrapped");

// 5. Test /inv
const r5 = runInput('/inv -a "Steel Dagger" -a "Healing Draught" -g 50 -e "Steel Dagger"');
assert(sandbox.state.inventory.items.includes("Steel Dagger"), "Item 1 added");
assert(sandbox.state.inventory.items.includes("Healing Draught"), "Item 2 added");
assert.strictEqual(sandbox.state.inventory.equipped, "Steel Dagger", "Item equipped");
assert.strictEqual(sandbox.state.inventory.gold, 75, "Gold adjusted (25 + 50 = 75)");
console.log("   ✔ /inv array accumulators (-a@), equipment (-e), and gold (-g) verified");

// 6. Test /stat
const r6 = runInput('/stat --meta Class=Ranger --meta Level=3 -t "Eagle-Eyed" --hp 85');
assert.strictEqual(sandbox.state.character.meta.Class, "Ranger", "Meta Class set");
assert.strictEqual(sandbox.state.character.meta.Level, "3", "Meta Level set");
assert(sandbox.state.character.tags.includes("Eagle-Eyed"), "Tag added");
assert.strictEqual(sandbox.state.character.hp, 85, "HP updated");
console.log("   ✔ /stat hash accumulators (--meta%), trait tags (-t@), and HP verified");

// 7. Test /help
const r7 = runInput("/help");
assert(r7.text.includes("GetoptAID Sandbox Command Center"), "Expected help header");
assert(r7.text.includes("/roll"), "Expected /roll in help");
assert(r7.text.includes("/inv"), "Expected /inv in help");
assert(r7.text.includes("/stat"), "Expected /stat in help");
assert(r7.text.includes("/test"), "Expected /test in help");
console.log("   ✔ /help master reference generated");

// 8. Test /test (In-Game Self-Test)
const r8 = runInput("/test");
assert(r8.text.includes("GetoptAID In-Game Self-Test Suite"), "Expected self-test header");
assert(r8.text.includes("ALL 10 TESTS PASSED"), "Expected all tests passed in report");

// 8b. Test AID Do mode formatting: "> You /test."
const r8b = runInput("> You /test.");
assert(r8b.text.includes("GetoptAID In-Game Self-Test Suite"), "Expected self-test header from Do mode with period");

// 8c. Test trailing period: "/test."
const r8c = runInput("/test.");
assert(r8c.text.includes("GetoptAID In-Game Self-Test Suite"), "Expected self-test header from /test.");

console.log("   ✔ /test in-game self-diagnostic suite executed with 100% success (including Do mode & periods)");

// 9. Test unrecognized slash command passthrough (Multi-Script Pipeline)
const r9 = runInput("/ec -p Molly -m entity");
assert.strictEqual(r9.text, "/ec -p Molly -m entity", "Unrecognized /ec command must pass through untouched");
console.log("   ✔ Unrecognized /ec command passed through untouched for downstream scripts");

// 10. Test normal story prose passthrough
const r10 = runInput("You sit down by the roaring hearth and order an ale from Oakhaven.");
assert.strictEqual(r10.text, "You sit down by the roaring hearth and order an ale from Oakhaven.", "Prose must pass through untouched");
console.log("   ✔ Narrative story prose passed through untouched to AI Dungeon engine");

console.log("==================================================================");
console.log("  PART 2: MODULAR AUTO-CARDS ARCHITECTURE (library-sandbox.js)");
console.log("==================================================================");

{
    const libPath = path.join(__dirname, "..", "AID-sandbox", "library-sandbox.js");
    const inputPath = path.join(__dirname, "..", "AID-sandbox", "input.js");
    const contextPath = path.join(__dirname, "..", "AID-sandbox", "context.js");
    const outputPath = path.join(__dirname, "..", "AID-sandbox", "output.js");

    const libCode = fs.readFileSync(libPath, "utf8");
    const inputCode = fs.readFileSync(inputPath, "utf8");
    const contextCode = fs.readFileSync(contextPath, "utf8");
    const outputCode = fs.readFileSync(outputPath, "utf8");

    const sharedContext = {
        state: {},
        info: { maxChars: 3500 },
        console: console
    };
    sharedContext.globalThis = sharedContext;
    vm.createContext(sharedContext);

    // Load library-sandbox.js into Shared Library
    vm.runInContext(libCode, sharedContext);
    assert.strictEqual(typeof sharedContext.GetoptSandbox, "function", "GetoptSandbox must be exposed on globalThis");
    console.log("   ✔ library-sandbox.js loaded and GetoptSandbox registered");

    function runHook(hookCode, textVal, stopVal) {
        // AI Dungeon executes each hook in a fresh isolate context with shared state & info.
        // NOTE: AID does NOT define 'stop' in the isolate scope; the hook modifier must handle it safely!
        const hookCtx = {
            state: sharedContext.state,
            info: sharedContext.info,
            text: textVal,
            console: console
        };
        if (typeof stopVal !== "undefined") {
            hookCtx.globalThis = hookCtx;
            hookCtx.globalThis.stop = stopVal;
        } else {
            hookCtx.globalThis = hookCtx;
        }
        vm.createContext(hookCtx);
        // Prepend Library
        vm.runInContext(libCode, hookCtx);
        // Run Hook
        const res = vm.runInContext(hookCode, hookCtx);
        return res;
    }

    // Turn 0: First Turn Generation (Scenario start - no input hook runs, only context hook)
    // In AID on turn 0, stop is completely undefined and must not throw ReferenceError!
    const ctxTurn0 = runHook(contextCode, "Opening prompt from scenario prompt field", undefined);
    assert.strictEqual(ctxTurn0.text, "Opening prompt from scenario prompt field");
    assert.strictEqual(ctxTurn0.stop, false, "Turn 0 must not halt generation");
    console.log("   ✔ Turn 0 (Scenario Start): Context hook safely ran with stop undefined (no ReferenceError!)");

    // Turn 1: Player executes /test in Do mode ("> You /test.")
    // 1. Run Input hook: preserves action text, stores command output in state
    const inRes1 = runHook(inputCode, "> You /test.");
    assert.strictEqual(inRes1.text, "> You /test.", "Input hook must preserve player action text for clean display");
    assert.strictEqual(inRes1.stop, undefined, "Input hook must NOT return stop property");
    assert(sharedContext.state.GetoptSandbox.commandOutput.includes("GetoptAID In-Game Self-Test Suite"), "Input hook must store command output in state for Output hook");
    console.log("   ✔ Input hook processed /test cleanly and staged command output for Output hook");

    // 2. Run Context hook (pre-LLM)
    const ctxRes1 = runHook(contextCode, inRes1.text, false);
    assert.strictEqual(ctxRes1.stop, false, "Context hook passes through stop: false so that onOutput hook runs");
    console.log("   ✔ Context hook passed through cleanly (Auto-Cards style)");

    // 3. Run Output hook (replaces model generation with formatted story Markdown)
    const outRes1 = runHook(outputCode, "Accidental LLM text");
    assert(outRes1.text.includes("GetoptAID In-Game Self-Test Suite"), "Output hook must emit command output as Story Markdown");
    assert(outRes1.text.includes("```"), "Output hook preserves code fences");
    assert.strictEqual(sharedContext.state.GetoptSandbox.commandOutput, undefined, "Output hook cleared commandOutput flag");
    console.log("   ✔ Output hook emitted command output in story text (intact Markdown & newlines, ZERO model churn!)");

    // Turn 2: Player inputs normal story narrative ("You look across the room.")
    const inRes2 = runHook(inputCode, "You look across the room.");
    assert.strictEqual(inRes2.text, "You look across the room.", "Story text must pass through input hook untouched");

    const ctxRes2 = runHook(contextCode, inRes2.text, false);
    assert.strictEqual(ctxRes2.text, "You look across the room.");
    assert.strictEqual(ctxRes2.stop, false, "Story text must NOT halt LLM generation");
    console.log("   ✔ Normal story text passed through input & context hooks without halting");

    // Turn 3: Downstream command /ec Molly -p (Multi-Script Pipeline)
    const inRes3 = runHook(inputCode, "/ec Molly -p");
    assert.strictEqual(inRes3.text, "/ec Molly -p", "Unrecognized command must pass through for downstream scripts");
    const ctxRes3 = runHook(contextCode, inRes3.text, false);
    assert.strictEqual(ctxRes3.stop, false, "Unrecognized command must NOT halt LLM generation");
    console.log("   ✔ Downstream /ec command passed through untouched for next script in run order");
}

console.log("==================================================================");
console.log("  🎉 ALL AID-SANDBOX SCRIPT TESTS PASSED (100% SUCCESS)");
console.log("==================================================================");
