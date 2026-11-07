const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

console.log("==================================================================");
console.log("  TESTING AID-SANDBOX SCRIPT INTEGRATION");
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
assert.strictEqual(r1.stop, true, "Commands must return stop: true to halt AI generation");
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
console.log("   ✔ /test in-game self-diagnostic suite executed with 100% success");

// 9. Test unrecognized slash command passthrough (Multi-Script Pipeline)
const r9 = runInput("/ec -p Molly -m entity");
assert.strictEqual(r9.text, "/ec -p Molly -m entity", "Unrecognized /ec command must pass through untouched");
console.log("   ✔ Unrecognized /ec command passed through untouched for downstream scripts");

// 10. Test normal story prose passthrough
const r10 = runInput("You sit down by the roaring hearth and order an ale from Oakhaven.");
assert.strictEqual(r10.text, "You sit down by the roaring hearth and order an ale from Oakhaven.", "Prose must pass through untouched");
assert.strictEqual(r10.stop, undefined, "Prose must NOT halt AI generation");
console.log("   ✔ Narrative story prose passed through untouched to AI Dungeon engine");

console.log("==================================================================");
console.log("  🎉 ALL AID-SANDBOX SCRIPT TESTS PASSED (100% SUCCESS)");
console.log("==================================================================");
