const assert = require("assert");
const GetoptAID = require("../src/getopt-aid");

console.log("==================================================================");
console.log("  TEST SUITE: GetoptAID (Layer 1 Option Parser & Layer 2 Router)");
console.log("==================================================================");

// ============================================================================
// PART 1: Layer 1 Core Option Parser (GetoptAID.getopt)
// ============================================================================

console.log("\n--- Part 1: Layer 1 Core Option Parser ---");

// Test 1.1: Boolean flags and Perl compact syntax
{
    const spec = {
        "version|v": false,
        "help|h|?":  false,
        "verbose|V+": 0
    };
    const r1 = GetoptAID.getopt("-v", spec);
    assert.strictEqual(r1.flags.version, true);
    assert.strictEqual(r1.target, "");

    const r2 = GetoptAID.getopt("--help", spec);
    assert.strictEqual(r2.flags.help, true);

    const r3 = GetoptAID.getopt("-?", spec);
    assert.strictEqual(r3.flags.help, true);

    const r4 = GetoptAID.getopt("-V -V -V", spec);
    assert.strictEqual(r4.flags.verbose, 3);
    console.log("   ✔ Boolean flags and Perl '+' counter modifier passed");
}

// Test 1.2: Perl-style type specifications (=s, =i, :s)
{
    const spec = {
        "mode|m=s":    "entity",
        "sides|d=i":   20,
        "redo|r:s":    false
    };
    const r1 = GetoptAID.getopt("-m classic -d 6", spec);
    assert.strictEqual(r1.flags.mode, "classic");
    assert.strictEqual(r1.flags.sides, 6);

    const r2 = GetoptAID.getopt("--mode=classic -d=100", spec);
    assert.strictEqual(r2.flags.mode, "classic");
    assert.strictEqual(r2.flags.sides, 100);

    const r3 = GetoptAID.getopt("-r Molly", spec);
    assert.strictEqual(r3.flags.redo, "Molly");

    const r4 = GetoptAID.getopt("-r", spec);
    assert.strictEqual(r4.flags.redo, true);
    console.log("   ✔ Perl-style typed specs (=s, =i, :s optional) passed");
}

// Test 1.3: Perl-style Array Accumulator (@) and Hash Accumulator (%)
{
    const spec = {
        "tag|t=s@":   [],
        "stat|s=s%":  {}
    };
    const r1 = GetoptAID.getopt('-t "Cyberpunk" -t Hacker -t "High Tech"', spec);
    assert.deepStrictEqual(r1.flags.tag, ["Cyberpunk", "Hacker", "High Tech"]);

    const r2 = GetoptAID.getopt("-s hp=100 -s mana=50 -s str=18", spec);
    assert.deepStrictEqual(r2.flags.stat, { hp: "100", mana: "50", str: "18" });
    console.log("   ✔ Perl-style array accumulator (@) and hash accumulator (%) passed");
}

// Test 1.4: Perl-style Closures / Action Callbacks
{
    let modeSet = "";
    let helpCalled = false;

    const spec = {
        "help|h": () => { helpCalled = true; return "Displaying Help Screen"; },
        "mode|m=s": (val) => { modeSet = val; return `Switched mode to ${val}`; }
    };

    const r1 = GetoptAID.getopt("-h", spec);
    assert.strictEqual(helpCalled, true);
    assert.strictEqual(r1.output, "Displaying Help Screen");

    const r2 = GetoptAID.getopt("-m classic", spec);
    assert.strictEqual(modeSet, "classic");
    assert.strictEqual(r2.output, "Switched mode to classic");
    console.log("   ✔ Perl-style closures and output string capture passed");
}

// Test 1.5: Mobile smart dashes, smart quotes, and trailing punctuation
{
    const spec = {
        "preset|P=s": null,
        "person|p": { type: "typeFlag", entityType: "Person" }
    };

    const r1 = GetoptAID.getopt('—preset lite “Molly Millions” –p', spec);
    assert.strictEqual(r1.flags.preset, "lite");
    assert.strictEqual(r1.flags.entityType, "Person");
    assert.strictEqual(r1.target, "Molly Millions");
    console.log("   ✔ Mobile smart dashes (—, –) and curly quotes (“ ”) normalized");
}

// Test 1.6: End-of-options delimiter (--)
{
    const spec = {
        "version|v": false
    };
    const r = GetoptAID.getopt('-- -v -NotAFlag-', spec);
    assert.strictEqual(r.flags.version, false);
    assert.strictEqual(r.target, "-v -NotAFlag-");
    console.log("   ✔ POSIX '--' delimiter stops option parsing");
}


// ============================================================================
// PART 2: Layer 2 Multi-Script Command Router (GetoptAID.cli)
// ============================================================================

console.log("\n--- Part 2: Layer 2 Multi-Script Command Router ---");

// Test 2.1: Router registration and dispatch
{
    const app = GetoptAID.cli();

    app.command("roll", {
        options: {
            "sides|d=i": 20,
            "mod|m=i":   0,
            "adv|a":     false
        },
        action: (opts, args, target) => {
            const roll = 15 + opts.mod;
            return `Rolled d${opts.sides} + ${opts.mod} = ${roll} for ${target}`;
        }
    });

    // Player inputs command
    const res = app.dispatch("/roll -d 6 -m 3 Fireball Damage");
    assert.strictEqual(res.matched, true);
    assert.strictEqual(res.command, "roll");
    assert.strictEqual(res.flags.sides, 6);
    assert.strictEqual(res.flags.mod, 3);
    assert.strictEqual(res.target, "Fireball Damage");
    assert.strictEqual(res.output, "Rolled d6 + 3 = 18 for Fireball Damage");
    console.log("   ✔ Command router registered, parsed options via Layer 1, and executed action");
}

// Test 2.2: Dialogue unwrapping (Say/Do mode)
{
    const app = GetoptAID.cli();
    app.command("ec", {
        aliases: ["ac"],
        options: {
            "person|p": { type: "typeFlag", entityType: "Person" }
        },
        action: (opts, args, target) => `Created ${opts.entityType} card: ${target}`
    });

    const res1 = app.dispatch('Joe says, "/ec -p Molly."');
    assert.strictEqual(res1.matched, true);
    assert.strictEqual(res1.command, "ec");
    assert.strictEqual(res1.flags.entityType, "Person");
    assert.strictEqual(res1.target, "Molly");
    assert.strictEqual(res1.output, "Created Person card: Molly");

    const res2 = app.dispatch('> You ask, "/ac -p Case!"');
    assert.strictEqual(res2.matched, true);
    assert.strictEqual(res2.command, "ec"); // matched alias ac -> canonical ec
    assert.strictEqual(res2.target, "Case");
    console.log("   ✔ Dialogue unwrapping across Say/Do quotes and aliases verified");
}

// Test 2.3: Non-interfering Pipeline Passthrough (The Multi-Script Golden Rule!)
{
    const app = GetoptAID.cli();
    app.command("ec", {
        action: () => "Handled EC"
    });

    // Case A: Input intended for another script (e.g. /roll)
    const resA = app.dispatch("/roll -d 20");
    assert.strictEqual(resA.matched, false);
    assert.strictEqual(resA.text, "/roll -d 20");

    // Case B: Regular narrative story action
    const resB = app.dispatch("Molly drew her flechette pistol.");
    assert.strictEqual(resB.matched, false);
    assert.strictEqual(resB.text, "Molly drew her flechette pistol.");
    console.log("   ✔ Unrecognized slash commands and story prose cleanly pass through (matched: false)");
}

// Test 2.4: Simulation of AI Dungeon Multi-Script Pipeline
{
    // Script 1: Entity-Cards
    const script1 = GetoptAID.cli().command("ec", {
        options: { "mode|m=s": "entity" },
        action: (opts) => `[EC] Switched to ${opts.mode}`
    });

    // Script 2: Player's Custom Dice Roller
    const script2 = GetoptAID.cli().command("roll", {
        options: { "sides|d=i": 20 },
        action: (opts) => `[DICE] Rolled ${opts.sides}`
    });

    function runPipeline(input) {
        let currentText = input;
        let responseMessage = null;

        // Script 1 in pipeline
        const r1 = script1.dispatch(currentText);
        if (r1.matched) {
            responseMessage = r1.output;
            currentText = ""; // consumed!
        }

        // Script 2 in pipeline
        if (currentText) {
            const r2 = script2.dispatch(currentText);
            if (r2.matched) {
                responseMessage = r2.output;
                currentText = ""; // consumed!
            }
        }

        return { finalStoryText: currentText, playerMessage: responseMessage };
    }

    // Pipeline Turn 1: Player executes /ec
    const turn1 = runPipeline("/ec -m classic");
    assert.strictEqual(turn1.playerMessage, "[EC] Switched to classic");
    assert.strictEqual(turn1.finalStoryText, "");

    // Pipeline Turn 2: Player executes /roll (Script 1 ignores it, Script 2 handles it!)
    const turn2 = runPipeline("/roll -d 100");
    assert.strictEqual(turn2.playerMessage, "[DICE] Rolled 100");
    assert.strictEqual(turn2.finalStoryText, "");

    // Pipeline Turn 3: Player inputs regular story action (Neither script consumes it!)
    const turn3 = runPipeline("Molly stepped into the night.");
    assert.strictEqual(turn3.playerMessage, null);
    assert.strictEqual(turn3.finalStoryText, "Molly stepped into the night.");

    console.log("   ✔ AI Dungeon multi-script pipeline simulation passed with 100% harmony");
}

// Part 3: In-Engine selfTest() Verification
console.log("\n--- Part 3: In-Engine selfTest() Diagnostic Verification ---");
{
    const report = GetoptAID.selfTest();
    assert.strictEqual(report.failed, 0, `Expected 0 failures, got ${report.failed}`);
    assert.strictEqual(report.passed, report.total, "All selfTest items should pass");
    assert(report.formatted.includes("ALL 10 TESTS PASSED"), "Formatted report should confirm success");
    console.log("   ✔ GetoptAID.selfTest() executed cleanly with 100% success");
}

console.log("\n==================================================================");
console.log("  🎉 ALL GetoptAID UNIT TESTS PASSED (100% SUCCESS)");
console.log("==================================================================");
