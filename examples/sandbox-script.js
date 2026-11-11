/**
 * ============================================================================
 * GetoptAID Sandbox Script for AI Dungeon
 * ============================================================================
 * 
 * An interactive slash-command suite demonstrating GetoptAID in AI Dungeon:
 * - /roll (dice roller with sides, counts, modifiers, and advantage)
 * - /inv  (inventory manager with array accumulators and gold tracking)
 * - /stat (character sheet with hash accumulators and trait tags)
 * - /help (automatic manual generator)
 * 
 * Works identically as:
 * 1. A standalone script in your AI Dungeon "Input" modifier tab.
 * 2. A modular script loaded alongside other creators' scripts in the
 *    AI Dungeon Multi-Script Pipeline (cleanly passes through unmatched input).
 * 
 * Author: Randy Viosca (@Random_Variable on AI Dungeon)
 * License: MIT
 */

// ============================================================================
// PART 1: EMBEDDED GetoptAID ENGINE (Layer 1 Parser & Layer 2 Router)
// ============================================================================
/**
 * AID-Getopt - POSIX/GNU-Style Option Parser & Multi-Script Slash Command Router for AI Dungeon
 *
 * Architecture:
 * - Layer 1: Core Option Parser (AIDGetopt.getopt / AIDGetopt.parse)
 *   POSIX & GNU-style option parsing, Perl-style compact specs ("mode|m=s", "tags|t=s@"),
 *   array/hash accumulators, closures/action callbacks, and mobile typography tolerance.
 * - Layer 2: Command Router & Multi-Script Dispatcher (AIDGetopt.cli / AIDGetopt.CLI)
 *   Multi-command slash router with dialogue unwrapping and non-interfering pipeline passthrough
 *   (matched: false) for sequential script execution in AI Dungeon.
 *
 * @version 1.0.0
 * @author Randy Viosca (@Random_Variable on AI Dungeon)
 * @license MIT
 */
(function(root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.AIDGetopt = root.GetoptAID = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
    "use strict";

    const VERSION = "1.0.0";
    const GIT_HASH = "69e75ac";
    const BUILD_TIME = "2026-11-11 05:09:31 UTC";

    /**
     * Tokenizes a command line string respecting single/double/smart quotes,
     * normalizing smart dashes, and preserving quoted literals.
     *
     * @param {string} input Raw command line string
     * @returns {Array<{ text: string, isQuoted: boolean }>} Array of tokens
     */
    function tokenize(input) {
        if (!input || typeof input !== "string") return [];

        let str = input.trim();
        // 1. Dialogue wrapper unpacking (Say mode: e.g. > You say, "..." or Joe says, "...")
        const sayMatch = str.match(/(?:^|\n)(?:>\s*)?(?:You|[A-Za-z0-9_]+)\s*(?:says?|asks?|exclaims?|shouts?),?\s*["“]([\s\S]*?)["”][\s.!?]*$/i);
        if (sayMatch) {
            str = sayMatch[1].trim();
        }
        // 2. Action prefix unpacking (Do mode: e.g. "> You /cmd" or "You /cmd" or "> You: /cmd")
        const doMatch = str.match(/^(?:>\s*)?(?:You:?\s+)?(\/[\s\S]*)/i);
        if (doMatch) {
            str = doMatch[1].trim();
        }
        // 3. Clean trailing speech/sentence punctuation at end of command (preserving -? and closing quotes)
        if (str !== "-?" && str !== "--?") {
            str = str.replace(/(?<=\S)[.!?,;:)]+$/, "");
        }

        const tokens = [];
        const tokenRegex = /"([^"]*)"|'([^']*)'|“([^”]*?)”|‘([^’]*?)’|(\S+)/g;
        let match;
        while ((match = tokenRegex.exec(str)) !== null) {
            const val = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5];
            const isQuoted = (match[5] === undefined);
            tokens.push({ text: val, isQuoted });
        }
        return tokens;
    }

    /**
     * Compiles a declarative or Perl-style options specification into a normalized lookup map.
     * Supports:
     * - Perl compact string notation: "mode|m=s", "count|c=i", "items|i=s@", "help|h|?"
     * - Full configuration objects with short, aliases, type, default, enum, action callbacks.
     */
    function compileSpec(rawSpec) {
        const normalized = {};

        for (const [keyPattern, rawDef] of Object.entries(rawSpec || {})) {
            let def = (typeof rawDef === "function")
                ? { action: rawDef }
                : (typeof rawDef === "object" && rawDef !== null)
                    ? Object.assign({}, rawDef)
                    : { default: rawDef };

            // Parse Perl-style compact key: e.g. "mode|m=s", "items|i=s@", "count|c=i", "help|h|?"
            const modMatch = keyPattern.match(/^([^=!:+]+)(?:([=!:+])([si]?)([@%]?)?)?$/);
            let canonicalName = keyPattern;
            let short = def.short;
            let aliases = Array.isArray(def.aliases) ? [...def.aliases] : [];

            if (modMatch) {
                const names = modMatch[1].split("|").map(s => s.trim()).filter(Boolean);
                canonicalName = names[0];
                for (let j = 1; j < names.length; j++) {
                    const alias = names[j];
                    if (alias.length === 1 && !short) {
                        short = alias;
                    } else if (!aliases.includes(alias)) {
                        aliases.push(alias);
                    }
                }

                const modifier = modMatch[2];
                const typeChar = modMatch[3];
                const container = modMatch[4];

                if (modifier === "=") {
                    def.type = (typeChar === "i") ? "number" : "string";
                } else if (modifier === ":") {
                    def.type = (typeChar === "i") ? "number" : "string";
                    def.optionalArg = true;
                } else if (modifier === "+") {
                    def.type = "counter";
                    def.default ??= 0;
                } else {
                    def.type ??= "boolean";
                }

                if (container === "@") {
                    def.accumulate = "array";
                    def.default ??= [];
                } else if (container === "%") {
                    def.accumulate = "hash";
                    def.default ??= {};
                }
            }

            def.short = short;
            def.aliases = aliases;
            normalized[canonicalName] = def;
        }

        return normalized;
    }

    /**
     * Layer 1: Core Option Parser
     * Parses tokens against an options specification.
     *
     * @param {string|Array} input String or pre-tokenized array
     * @param {Object} spec Options specification object
     * @returns {{ flags: Object, operands: Array<string>, target: string, errors: Array<string>, output: string, hasFlag: Function }}
     */
    function getopt(input, spec = {}) {
        const tokens = Array.isArray(input)
            ? input.map(t => (typeof t === "string" ? { text: t, isQuoted: false } : t))
            : tokenize(input);

        const compiled = compileSpec(spec);
        const lookupExact = new Map();
        const lookupLower = new Map();

        for (const [key, def] of Object.entries(compiled)) {
            const entry = { key, def };
            lookupLower.set(`--${key.toLowerCase()}`, entry);
            lookupLower.set(`-${key.toLowerCase()}`, entry);

            if (def.short) {
                lookupExact.set(`-${def.short}`, entry);
                lookupExact.set(`--${def.short}`, entry);
            }

            if (Array.isArray(def.aliases)) {
                for (const alias of def.aliases) {
                    lookupLower.set(`--${alias.toLowerCase()}`, entry);
                    lookupLower.set(`-${alias.toLowerCase()}`, entry);
                    if (alias.length === 1) {
                        lookupExact.set(`-${alias}`, entry);
                    }
                }
            }
        }

        const flags = {};
        const operands = [];
        const errors = [];
        let output = "";
        let endOfOptions = false;

        // Initialize defaults
        for (const [key, def] of Object.entries(compiled)) {
            if (def.default !== undefined) {
                flags[key] = Array.isArray(def.default)
                    ? [...def.default]
                    : (typeof def.default === "object" && def.default !== null)
                        ? Object.assign({}, def.default)
                        : def.default;
            }
        }

        for (let i = 0; i < tokens.length; i++) {
            let { text, isQuoted } = tokens[i];

            if (isQuoted || endOfOptions) {
                operands.push(text);
                continue;
            }

            if (text === "--") {
                endOfOptions = true;
                continue;
            }

            // Normalize mobile smart dashes (en-dash, em-dash)
            if (/^[—–]/.test(text)) {
                text = text.replace(/^[—–]{2}/, "--").replace(/^[—–]/, "-");
            }

            // Clean trailing punctuation on flags while preserving -?
            const cleanFlag = (text === "-?" || text === "--?") ? text : text.replace(/(?<=\w)[.!?,;:"”'’)]+$/, "");

            if (!cleanFlag.startsWith("-")) {
                operands.push(text);
                continue;
            }

            // Check for inline value: --flag=value or -f=value
            let flagName = cleanFlag;
            let inlineVal = null;
            const eqIdx = cleanFlag.indexOf("=");
            if (eqIdx !== -1) {
                flagName = cleanFlag.slice(0, eqIdx);
                inlineVal = cleanFlag.slice(eqIdx + 1).replace(/^["“'’]|["”'’]$/g, "");
            }

            // Match flag: exact case first (for case-sensitive short flags like -P vs -p)
            let matched = lookupExact.get(flagName) || lookupLower.get(flagName.toLowerCase());

            if (!matched) {
                // Not recognized in spec: treat as positional operand
                operands.push(text);
                continue;
            }

            const { key, def } = matched;
            const optType = def.type || "boolean";

            // Incremental counter (+ modifier)
            if (optType === "counter") {
                flags[key] = (flags[key] || 0) + 1;
                if (typeof def.action === "function") {
                    const ret = def.action(flags[key], key);
                    if (typeof ret === "string") output += ret;
                }
                continue;
            }

            // Boolean flag
            if (optType === "boolean") {
                flags[key] = true;
                if (typeof def.action === "function") {
                    const ret = def.action(true, key);
                    if (typeof ret === "string") output += ret;
                }
                continue;
            }

            // Type flag (custom metadata tagging e.g. Entity Cards -p / Person)
            if (optType === "typeFlag") {
                flags[key] = true;
                if (def.entityType) {
                    flags.entityType = def.entityType;
                    flags.matchedAlias = flagName.replace(/^-{1,2}/, "").toLowerCase();
                }
                if (typeof def.action === "function") {
                    const ret = def.action(def.entityType || true, key);
                    if (typeof ret === "string") output += ret;
                }
                continue;
            }

            // Value options
            let val = inlineVal;
            if (val === null) {
                if (i + 1 < tokens.length && (!tokens[i + 1].text.startsWith("-") || tokens[i + 1].isQuoted)) {
                    val = tokens[++i].text;
                } else if (def.optionalArg) {
                    val = true;
                } else {
                    errors.push(`Missing argument for option ${flagName}`);
                    flags[key] = "";
                    continue;
                }
            }

            // Value conversion
            let parsedVal = val;
            if (val !== true) {
                if (optType === "number") {
                    const num = Number(val);
                    parsedVal = isNaN(num) ? val : num;
                } else if (optType === "string") {
                    parsedVal = String(val);
                }
            }

            // Enum validation
            if (Array.isArray(def.enum) && !def.enum.includes(parsedVal)) {
                errors.push(`Invalid value '${parsedVal}' for ${flagName}. Expected: ${def.enum.join(", ")}`);
            }

            // Accumulators (@ for array, % for hash)
            if (def.accumulate === "array") {
                flags[key] = Array.isArray(flags[key]) ? flags[key] : [];
                flags[key].push(parsedVal);
            } else if (def.accumulate === "hash") {
                flags[key] = (typeof flags[key] === "object" && flags[key] !== null) ? flags[key] : {};
                const hashEq = String(parsedVal).indexOf("=");
                if (hashEq !== -1) {
                    const hKey = String(parsedVal).slice(0, hashEq).trim();
                    const hVal = String(parsedVal).slice(hashEq + 1).trim();
                    flags[key][hKey] = hVal;
                } else {
                    flags[key][parsedVal] = true;
                }
            } else {
                flags[key] = parsedVal;
            }

            // Execute Perl-style closure / callback if provided
            if (typeof def.action === "function") {
                const ret = def.action(flags[key], key);
                if (typeof ret === "string") {
                    output += ret;
                }
            }
        }

        return {
            flags,
            operands,
            target: operands.join(" ").trim(),
            errors,
            output,
            hasFlag: (name) => flags[name] !== undefined && flags[name] !== false
        };
    }

    /**
     * Layer 2: Command Router & Multi-Script Dispatcher
     * Manages multiple slash commands, handles dialogue wrappers, and guarantees
     * non-interfering passthrough for sequential script execution in AI Dungeon.
     */
    class Router {
        constructor() {
            this.commands = new Map();
        }

        /**
         * Registers a slash command.
         *
         * @param {string} name Command name (e.g. "roll", "ec", "inv")
         * @param {Object} def Command definition { aliases, options, action, description }
         * @returns {Router} this
         */
        command(name, def = {}) {
            const canonical = name.toLowerCase().replace(/^\/+/, "");
            const entry = Object.assign({ name: canonical }, def);
            this.commands.set(canonical, entry);

            if (Array.isArray(def.aliases)) {
                for (const alias of def.aliases) {
                    this.commands.set(alias.toLowerCase().replace(/^\/+/, ""), entry);
                }
            }
            return this;
        }

        /**
         * Dispatches an incoming player input string.
         * If the input matches a registered command, it parses its options and executes its action.
         * If the input does NOT match any command, it immediately returns { matched: false },
         * allowing the input to pass through untouched down the AI Dungeon script sequence!
         *
         * @param {string} input Player input string
         * @param {*} [context] Optional game/adventure context object passed to action callbacks
         * @returns {{ matched: boolean, command?: string, flags?: Object, operands?: Array<string>, target?: string, output?: string, errors?: Array<string>, text?: string }}
         */
        dispatch(input, context) {
            if (!input || typeof input !== "string") {
                return { matched: false, text: input };
            }

            let str = input.trim();
            // 1. Dialogue wrapper unpacking (Say mode: e.g. > You say, "..." or Joe says, "...")
            const sayMatch = str.match(/(?:^|\n)(?:>\s*)?(?:You|[A-Za-z0-9_]+)\s*(?:says?|asks?|exclaims?|shouts?),?\s*["“]([\s\S]*?)["”][\s.!?]*$/i);
            if (sayMatch) {
                str = sayMatch[1].trim();
            }
            // 2. Action prefix unpacking (Do mode: e.g. "> You /cmd" or "You /cmd" or "> You: /cmd")
            const doMatch = str.match(/^(?:>\s*)?(?:You:?\s+)?(\/[\s\S]*)/i);
            if (doMatch) {
                str = doMatch[1].trim();
            }
            // 3. Clean trailing speech/sentence punctuation at end of command (preserving -? and closing quotes)
            if (str !== "-?" && str !== "--?") {
                str = str.replace(/(?<=\S)[.!?,;:)]+$/, "");
            }

            // Check if input begins with a slash command: e.g. /roll or /ec
            const cmdMatch = str.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*)|$)/);
            if (!cmdMatch) {
                return { matched: false, text: input };
            }

            const cmdName = cmdMatch[1].toLowerCase();
            const restArgs = cmdMatch[2] || "";

            if (!this.commands.has(cmdName)) {
                // Not registered with this router: pass through down the pipeline!
                return { matched: false, text: input };
            }

            const cmdDef = this.commands.get(cmdName);

            // Reuse Layer 1 (getopt) to parse arguments for this specific command!
            const parsed = getopt(restArgs, cmdDef.options || {});

            let output = parsed.output || "";
            if (typeof cmdDef.action === "function") {
                const actionRet = cmdDef.action(parsed.flags, parsed.operands, parsed.target, context);
                if (typeof actionRet === "string") {
                    output = actionRet + (output ? "\n" + output : "");
                }
            }

            return {
                matched: true,
                command: cmdDef.name,
                flags: parsed.flags,
                operands: parsed.operands,
                target: parsed.target,
                output,
                errors: parsed.errors
            };
        }

        /**
         * Generates formatted command help reference.
         * @returns {string} Formatted help listing
         */
        help() {
            let out = "Commands:\n";
            const seen = new Set();
            for (const [_, cmd] of this.commands) {
                if (seen.has(cmd.name)) continue;
                seen.add(cmd.name);
                const aliasStr = cmd.aliases?.length ? ` (aliases: /${cmd.aliases.join(", /")})` : "";
                const descStr = cmd.description ? ` - ${cmd.description}` : "";
                out += `  /${cmd.name}${aliasStr}${descStr}\n`;
            }
            return out;
        }
    }

    /**
     * Factory function creating a new Command Router (Layer 2).
     */
    function cli() {
        return new Router();
    }

    /**
     * Executes an in-engine self-test suite verifying Layer 1 option parsing,
     * Layer 2 command routing, mobile normalization, and pipeline passthrough.
     * Ideal for in-game diagnostic slash commands (e.g. /test) in AI Dungeon.
     *
     * @param {Object} [options]
     * @param {boolean} [options.verbose=false] Include detailed test descriptions
     * @returns {{ passed: number, failed: number, total: number, results: Array<{ name: string, passed: boolean, error?: string }>, formatted: string }}
     */
    function selfTest(options = {}) {
        const results = [];

        function run(name, fn) {
            try {
                fn();
                results.push({ name, passed: true });
            } catch (err) {
                results.push({ name, passed: false, error: err.message || String(err) });
            }
        }

        // Test 1: Short & long boolean flags
        run("Short & long boolean flags (-v, --help)", () => {
            const r = getopt("-v --help", { "verbose|v": false, "help|h": false });
            if (r.flags.verbose !== true || r.flags.help !== true) throw new Error("Flags not set to true");
        });

        // Test 2: Typed arguments and default values
        run("Typed arguments (=s, =i) and defaults", () => {
            const r = getopt("-m raw -c 5", { "mode|m=s": "auto", "count|c=i": 1 });
            if (r.flags.mode !== "raw") throw new Error(`Expected mode "raw", got "${r.flags.mode}"`);
            if (r.flags.count !== 5) throw new Error(`Expected count 5, got ${r.flags.count}`);
        });

        // Test 3: Array accumulator (@)
        run("Array accumulators (@)", () => {
            const r = getopt("-t fire -t magic", { "tag|t=s@": [] });
            if (!Array.isArray(r.flags.tag) || r.flags.tag.length !== 2 || r.flags.tag[0] !== "fire" || r.flags.tag[1] !== "magic") {
                throw new Error(`Array mismatch: ${JSON.stringify(r.flags.tag)}`);
            }
        });

        // Test 4: Hash accumulator (%)
        run("Hash accumulators (%)", () => {
            const r = getopt("--meta class=Rogue --meta level=3", { "meta=s%": {} });
            if (!r.flags.meta || r.flags.meta.class !== "Rogue" || r.flags.meta.level !== "3") {
                throw new Error(`Hash mismatch: ${JSON.stringify(r.flags.meta)}`);
            }
        });

        // Test 5: Incremental counter modifier (+)
        run("Incremental counter (+)", () => {
            const r = getopt("-v -v -v", { "verbose|v+": 0 });
            if (r.flags.verbose !== 3) throw new Error(`Expected 3, got ${r.flags.verbose}`);
        });

        // Test 6: Mobile smart dashes and curly quotes
        run("Mobile smart dashes (—, –) and curly quotes (“ ”)", () => {
            const r = getopt("—mode “epic quest” –c 10", { "mode|m=s": "", "count|c=i": 0 });
            if (r.flags.mode !== "epic quest") throw new Error(`Smart quote target mismatch: ${r.flags.mode}`);
            if (r.flags.count !== 10) throw new Error(`Smart dash flag mismatch: ${r.flags.count}`);
        });

        // Test 7: POSIX '--' delimiter stops option parsing
        run("POSIX '--' delimiter stops option parsing", () => {
            const r = getopt("-- -v literalWord", { "verbose|v": false });
            if (r.flags.verbose !== false) throw new Error("Option parsed after -- delimiter");
            if (!r.operands.includes("-v")) throw new Error("-v should be literal operand");
        });

        // Test 8: Layer 2 Router registration & dispatch
        run("Layer 2 Router dispatch & action routing", () => {
            const testApp = cli();
            let actionRan = false;
            testApp.command("testroll", {
                options: { "sides|d=i": 20 },
                action: (opts, args, target) => {
                    actionRan = true;
                    return `Rolled ${opts.sides} for ${target}`;
                }
            });
            const res = testApp.dispatch("/testroll -d 10 Dragon");
            if (!res.matched) throw new Error("Command failed to match");
            if (!actionRan) throw new Error("Action did not execute");
            if (res.flags.sides !== 10) throw new Error(`Expected sides 10, got ${res.flags.sides}`);
            if (res.target !== "Dragon") throw new Error(`Expected target Dragon, got ${res.target}`);
        });

        // Test 9: Dialogue unwrapping in Say/Do mode
        run("Say/Do dialogue unwrapping", () => {
            const testApp = cli();
            testApp.command("check", {
                options: { "val|v=i": 0 },
                action: (opts) => `OK:${opts.val}`
            });
            const r1 = testApp.dispatch('Joe says, "/check -v 42."');
            if (!r1.matched || r1.flags.val !== 42) throw new Error("Dialogue with trailing period inside quote failed");
            const r2 = testApp.dispatch('> You say, "/check -v 99".');
            if (!r2.matched || r2.flags.val !== 99) throw new Error("Dialogue with trailing period outside quote failed");
        });

        // Test 10: Multi-script pipeline passthrough
        run("Multi-script pipeline passthrough (matched: false)", () => {
            const testApp = cli();
            testApp.command("localcmd", {});
            const rOther = testApp.dispatch("/othercreator -x val");
            if (rOther.matched !== false || rOther.text !== "/othercreator -x val") {
                throw new Error("Unregistered slash command was not passed through");
            }
            const rProse = testApp.dispatch("You walk into the tavern.");
            if (rProse.matched !== false || rProse.text !== "You walk into the tavern.") {
                throw new Error("Narrative prose was not passed through");
            }
        });

        const passed = results.filter(r => r.passed).length;
        const failed = results.filter(r => !r.passed).length;
        const total = results.length;

        const lines = [
            "==================================================================",
            `  🎯 AID-Getopt In-Game Self-Test Suite (v${VERSION})`,
            `  Build: ${GIT_HASH} [${BUILD_TIME}]`,
            "=================================================================="
        ];

        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            const icon = r.passed ? "✔" : "✖";
            lines.push(`  ${icon} ${i + 1}. ${r.name}`);
            if (!r.passed && r.error) {
                lines.push(`     ⚠️ Error: ${r.error}`);
            }
        }

        lines.push("------------------------------------------------------------------");
        if (failed === 0) {
            lines.push(`  🎉 ALL ${total} TESTS PASSED (100% OPERATIONAL IN AI DUNGEON)`);
        } else {
            lines.push(`  ⚠️ ${failed} OF ${total} TESTS FAILED`);
        }
        lines.push("==================================================================");

        return {
            passed,
            failed,
            total,
            results,
            formatted: lines.join("\n")
        };
    }

    /**
     * Structured metadata for module discovery and introspection.
     */
    function getInfo() {
        return {
            name: "AID-Getopt",
            version: VERSION,
            gitHash: GIT_HASH,
            buildTime: BUILD_TIME,
            environment: (typeof globalThis !== "undefined" && globalThis.state)
                ? "AI Dungeon QuickJS"
                : (typeof process !== "undefined" && process.versions?.node)
                    ? "Node.js"
                    : "JavaScript"
        };
    }

    /**
     * One-line summary for calling scripts' /version and /info commands.
     */
    function getDiag() {
        return `AID-Getopt v${VERSION} (${GIT_HASH}) [${BUILD_TIME}]`;
    }

    const api = {
        name: "AID-Getopt",
        version: VERSION,
        gitHash: GIT_HASH,
        buildTime: BUILD_TIME,
        info: getInfo,
        diag: getDiag,
        // Layer 1: Core Option Parser
        tokenize,
        getopt,
        parse: getopt,
        getoptLong: getopt,
        compileSpec,
        // Layer 2: Command Router
        CLI: Router,
        Router,
        cli,
        // In-game diagnostics & test
        selfTest,
        test: selfTest
    };

    // Safe global environment & module registry for AI Dungeon scripts
    if (typeof globalThis !== "undefined") {
        const modRecord = {
            name: "AID-Getopt",
            version: VERSION,
            gitHash: GIT_HASH,
            buildTime: BUILD_TIME,
            author: "Randy Viosca (@Random_Variable)",
            prefix: "/aid-getopt",
            aliases: ["/aid-getopts"],
            description: "POSIX/GNU option parser & multi-script slash command router",
            helpSummary: "Router diagnostics and self-test suite (/aid-getopt --diag, /aid-getopt --test)",
            diag: getDiag
        };
        (globalThis.AID_MODULES ??= {})["aid-getopt"] = modRecord;
        globalThis.AID_MODULES["getopt-aid"] = modRecord; // backward compatibility
        if (!globalThis.AIDGetopt || globalThis.AIDGetopt.version < VERSION) {
            globalThis.AIDGetopt = api;
        }
        if (!globalThis.GetoptAID || globalThis.GetoptAID.version < VERSION) {
            globalThis.GetoptAID = api; // backward compatibility
        }
    }

    return api;
});

// ============================================================================
// PART 2: COMMAND DEFINITIONS & ROUTER CONFIGURATION
// ============================================================================

const app = (typeof globalThis !== "undefined" && (globalThis.AIDGetopt || globalThis.GetoptAID))
    ? (globalThis.AIDGetopt || globalThis.GetoptAID).cli()
    : new Router();

// Command 1: /roll - Dice Roller with modifiers, counts, and advantage
app.command("roll", {
    aliases: ["r", "dice"],
    description: "Roll polyhedral dice with modifiers and advantage",
    options: {
        "dice|d=i": 20,
        "count|c=i": 1,
        "mod|m=i": 0,
        "adv|a": false,
        "dis": false,
        "secret|s": false,
        "help|h|?": false
    },
    action: (flags, operands, target) => {
        if (flags.help) {
            return [
                "🎲 [ROLL HELP]",
                "Usage: /roll [-d sides] [-c count] [-m modifier] [-a (advantage)] [--dis (disadvantage)]",
                "Examples:",
                "  /roll -d 20 -m 3        (Roll 1d20+3)",
                "  /roll -c 3 -d 6         (Roll 3d6)",
                "  /roll -d 20 -a          (Roll with advantage)",
                "  /roll -d 100            (Roll percentile d100)"
            ].join("\n");
        }

        const sides = Math.max(2, flags.dice || 20);
        const count = Math.max(1, Math.min(20, flags.count || 1));
        const mod = flags.mod || 0;

        if (flags.adv || flags.dis) {
            // Advantage / Disadvantage (rolls twice on 1 die)
            const roll1 = Math.floor(Math.random() * sides) + 1;
            const roll2 = Math.floor(Math.random() * sides) + 1;
            const chosen = flags.adv ? Math.max(roll1, roll2) : Math.min(roll1, roll2);
            const total = chosen + mod;
            const modeName = flags.adv ? "Advantage" : "Disadvantage";
            const modStr = mod !== 0 ? (mod > 0 ? `+${mod}` : `${mod}`) : "";
            return `🎲 [DICE ROLL (${modeName})]\nRolled 2d${sides}: [${roll1}, ${roll2}] -> Kept ${chosen}${modStr} = **${total}**`;
        }

        const rolls = [];
        let sum = 0;
        for (let i = 0; i < count; i++) {
            const r = Math.floor(Math.random() * sides) + 1;
            rolls.push(r);
            sum += r;
        }
        const total = sum + mod;
        const rollList = rolls.length > 1 ? ` [${rolls.join(", ")}]` : ` [${rolls[0]}]`;
        const modStr = mod !== 0 ? (mod > 0 ? `+${mod}` : `${mod}`) : "";
        return `🎲 **[DICE ROLL]**\n\nRolled ${count}d${sides}${modStr}:${rollList} = **${total}**`;
    }
});

// Command 2: /inv - Interactive Inventory Manager
app.command("inv", {
    aliases: ["i", "inventory", "bag"],
    description: "Manage inventory items, equipment, and gold",
    options: {
        "add|a=s@": [],
        "drop|d=s@": [],
        "equip|e=s": null,
        "gold|g=i": 0,
        "list|l": false,
        "clear": false,
        "help|h|?": false
    },
    action: (flags, operands, target, context) => {
        const state = context.state ?? (typeof globalThis !== "undefined" ? globalThis.state : {}) ?? {};
        state.inventory ??= {
            items: ["Bedroll", "Flint & Steel", "Rations (3 days)"],
            equipped: "Iron Shortsword",
            gold: 25
        };
        const inv = state.inventory;

        if (flags.help) {
            return [
                "📦 [INVENTORY HELP]",
                "Usage: /inv [-l] [-a item] [-d item] [-e item] [-g gold]",
                "Examples:",
                "  /inv -l                             (List inventory)",
                '  /inv -a "Steel Dagger" -a "Potion"   (Add multiple items)',
                '  /inv -e "Steel Dagger"              (Equip an item)',
                '  /inv -d "Potion"                    (Drop an item)',
                "  /inv -g 50                          (Add 50 gold coins)",
                "  /inv -g -10                         (Spend 10 gold coins)"
            ].join("\n");
        }

        const logs = [];

        // Adjust gold
        if (flags.gold !== 0) {
            inv.gold = Math.max(0, inv.gold + flags.gold);
            logs.push(`💰 Gold updated: ${flags.gold > 0 ? `+${flags.gold}` : flags.gold} (Current: ${inv.gold} coins)`);
        }

        // Add items
        if (Array.isArray(flags.add) && flags.add.length > 0) {
            for (const item of flags.add) {
                inv.items.push(item);
                logs.push(`➕ Acquired: ${item}`);
            }
        }

        // Drop items
        if (Array.isArray(flags.drop) && flags.drop.length > 0) {
            for (const dropItem of flags.drop) {
                const idx = inv.items.findIndex(it => it.toLowerCase() === dropItem.toLowerCase());
                if (idx !== -1) {
                    const removed = inv.items.splice(idx, 1)[0];
                    logs.push(`➖ Dropped: ${removed}`);
                } else {
                    logs.push(`⚠️ Not in pack: "${dropItem}"`);
                }
            }
        }

        // Equip item
        if (flags.equip) {
            inv.equipped = flags.equip;
            logs.push(`🗡️ Equipped: ${flags.equip}`);
        }

        // Clear pack
        if (flags.clear) {
            inv.items = [];
            inv.equipped = null;
            logs.push("🗑️ Inventory cleared.");
        }

        // Render sheet
        const out = [];
        if (logs.length > 0) {
            out.push(logs.map(l => `> *${l}*`).join("\n\n"));
        }

        out.push("**📦 [INVENTORY]**");
        out.push(`- **Equipped:** ${inv.equipped || "(none)"}`);
        out.push(`- **Pack:** ${inv.items.length ? inv.items.join(", ") : "(empty)"}`);
        out.push(`- **Gold:** ${inv.gold} coins`);

        return out.join("\n\n");
    }
});

// Command 3: /stat - Character Status & Custom Attributes
app.command("stat", {
    aliases: ["s", "status", "char", "sheet"],
    description: "Manage character health, mana, tags, and metadata",
    options: {
        "hp=i": null,
        "mp=i": null,
        "tag|t=s@": [],
        "meta=s%": {},
        "view|v": false,
        "reset": false,
        "help|h|?": false
    },
    action: (flags, operands, target, context) => {
        const state = context.state ?? (typeof globalThis !== "undefined" ? globalThis.state : {}) ?? {};
        state.character ??= {
            hp: 100,
            maxHp: 100,
            mp: 50,
            maxMp: 50,
            tags: ["Adventurer", "Resourceful"],
            meta: { Class: "Wanderer", Level: "1" }
        };
        const char = state.character;

        if (flags.help) {
            return [
                "🛡️ [CHARACTER STATUS HELP]",
                "Usage: /stat [-v] [--hp N] [--mp N] [-t tag] [--meta key=val]",
                "Examples:",
                "  /stat -v                            (View character sheet)",
                "  /stat --hp 85 --mp 40               (Update HP and MP)",
                '  /stat -t "stealthy" -t "bilingual"  (Add trait tags)',
                "  /stat --meta Class=Ranger --meta Lvl=3 (Set metadata)"
            ].join("\n");
        }

        if (flags.reset) {
            char.hp = 100;
            char.mp = 50;
            char.tags = ["Adventurer"];
            char.meta = { Class: "Wanderer", Level: "1" };
            return "🔄 Character stats reset to default.";
        }

        if (flags.hp !== null) char.hp = Math.max(0, Math.min(char.maxHp, flags.hp));
        if (flags.mp !== null) char.mp = Math.max(0, Math.min(char.maxMp, flags.mp));

        if (Array.isArray(flags.tag) && flags.tag.length > 0) {
            for (const t of flags.tag) {
                if (!char.tags.includes(t)) char.tags.push(t);
            }
        }

        if (flags.meta && typeof flags.meta === "object") {
            for (const [k, v] of Object.entries(flags.meta)) {
                char.meta[k] = v;
            }
        }

        const metaParts = Object.entries(char.meta).map(([k, v]) => `${k}: ${v}`).join(" | ");
        return [
            "**🛡️ [CHARACTER STATUS]**",
            `- **Class/Meta:** ${metaParts || "Adventurer"}`,
            `- **Health:** ${char.hp}/${char.maxHp} HP  |  **Mana:** ${char.mp}/${char.maxMp} MP`,
            `- **Traits:** ${char.tags.join(", ") || "(none)"}`
        ].join("\n\n");
    }
});

// Command 4: /help - Master Adventure Command Directory & Help Generator
app.command("help", {
    aliases: ["h", "?"],
    description: "Display active adventure commands, loaded modules, and manuals",
    options: {
        "help|h|?": false
    },
    action: (flags, operands) => {
        const target = (operands[0] || "").toLowerCase().replace(/^\/+/, "");

        // If specific module or command help is requested (e.g. /help aid-getopt or /help roll)
        if (target) {
            if (target === "aid-getopt" || target === "aid-getopts") {
                return [
                    "==================================================================",
                    "  ⚙️ /aid-getopt - Router Diagnostics & Engine Self-Test",
                    "==================================================================",
                    "Usage: /aid-getopt [--diag|-d] [--test|-t] [--version|-v] [--help|-h]",
                    "Aliases: /aid-getopts",
                    "Options:",
                    "  --diag, -d     Run comprehensive system, memory, and state diagnostics",
                    "  --test, -t     Run in-engine automated self-diagnostic test suite",
                    "  --version, -v  Display engine build version, git commit, and runtime",
                    "  --help, -h     Display this manual",
                    "Tips:",
                    "  • Inspect context payload: /aid-getopt --diag -c",
                    "  • Inspect memory state:   /aid-getopt --diag -m",
                    "  • Verbose self-tests:     /aid-getopt --test -v",
                    "=================================================================="
                ].join("\n");
            }
            if (app.commands.has(target)) {
                const cmd = app.commands.get(target);
                return [
                    "==================================================================",
                    `  📖 /${cmd.name} Command Manual`,
                    "==================================================================",
                    `Description: ${cmd.description || "(no description)"}`,
                    cmd.aliases?.length ? `Aliases:     /${cmd.aliases.join(", /")}` : "",
                    "=================================================================="
                ].filter(Boolean).join("\n");
            }
        }

        // Build Master Adventure Command Directory
        const lines = [
            "==================================================================",
            "  🌟 ADVENTURE COMMAND DIRECTORY",
            "=================================================================="
        ];

        // 1. Inspect registered modules in AMS / globalThis.AID_MODULES
        const mods = (typeof globalThis !== "undefined" && globalThis.AID_MODULES) ? globalThis.AID_MODULES : {};
        const modEntries = Object.entries(mods).filter(([k, v]) => v && typeof v === "object" && k !== "getopt-aid");

        const storyModules = [];
        const infraModules = [];

        for (const [key, mod] of modEntries) {
            const prefix = mod.prefix || (key.startsWith("aid-") ? `/${key}` : null);
            const summary = mod.helpSummary || mod.description || "Active AI Dungeon module";
            const item = { name: mod.name || key, version: mod.version || "1.0.0", prefix, summary, aliases: mod.aliases || [] };

            if (key === "aid-getopt" || key === "aid-modules" || key.startsWith("aid-")) {
                infraModules.push(item);
            } else {
                storyModules.push(item);
            }
        }

        if (storyModules.length > 0) {
            lines.push("📖 Story & Gameplay Systems:");
            for (const m of storyModules) {
                const pfxStr = m.prefix ? `${m.prefix}${m.aliases?.length ? ` (or ${m.aliases.join(", ")})` : ""}` : `[${m.name}]`;
                lines.push(`  ${pfxStr.padEnd(18)} - ${m.name} (v${m.version})`);
                lines.push(`                     ${m.summary}`);
            }
            lines.push("");
        }

        // 2. Demo / local sandbox commands (if any)
        const localCmds = [];
        const seenNames = new Set(["help", "aid-getopt", "aid-getopts"]);
        for (const [name, def] of app.commands) {
            if (seenNames.has(name) || name === def.name && seenNames.has(def.name)) continue;
            seenNames.add(name);
            seenNames.add(def.name);
            localCmds.push(def);
        }

        if (localCmds.length > 0) {
            lines.push("🎲 Gameplay & Utility Commands:");
            for (const c of localCmds) {
                const aliasStr = c.aliases?.length ? ` (or /${c.aliases.join(", /")})` : "";
                lines.push(`  /${c.name}${aliasStr}`.padEnd(18) + ` - ${c.description || ""}`);
            }
            lines.push("");
        }

        // 3. Developer & Diagnostic Tools
        lines.push("🛠️ Developer & Diagnostics:");
        lines.push("  /aid-getopt        - Router diagnostics & engine self-tests (/aid-getopt --diag, --test)");
        if (mods["aid-modules"]) {
            lines.push("  /aid-modules       - View loaded system modules & versions (/aid-modules -v)");
        }
        lines.push("");
        lines.push("Tips:");
        lines.push("  • Type any system's command with 'help' (e.g. /ec help, /aid-getopt --help)");
        lines.push("  • All commands operate safely in Do, Say, or Story mode.");
        lines.push("  • Normal story prose passes through untouched down the script waterfall!");
        lines.push("==================================================================");

        return lines.join("\n");
    }
});

// Command 5: /aid-getopt - Low-Level Engine Diagnostics & Self-Tests
app.command("aid-getopt", {
    aliases: ["aid-getopts"],
    description: "Display AID-Getopt router status, run diagnostics, or execute self-tests",
    options: {
        "diag|d": false,
        "test|t": false,
        "version|v": false,
        "help|h|?": false,
        // Diag sub-flags
        "memory|m": false,
        "info|i": false,
        "state|s": false,
        "context|c": false,
        "all|a": false,
        // Test sub-flags
        "verbose": false
    },
    action: (flags, operands, target, context) => {
        const sub = (operands[0] || "").toLowerCase();

        // 1. Help
        if (flags.help || sub === "help") {
            return [
                "==================================================================",
                "  ⚙️ /aid-getopt Command Manual",
                "==================================================================",
                "Usage: /aid-getopt [options] [diag|test|version|help]",
                "Aliases: /aid-getopts",
                "Options:",
                "  --diag, -d     Run comprehensive runtime & state diagnostics",
                "  --test, -t     Run in-engine automated self-diagnostic test suite",
                "  --version, -v  Display engine build version, git commit, and runtime",
                "  --help, -h     Display this manual",
                "Diagnostics Sub-Flags (with --diag):",
                "  -c, --context  Inspect model context payload received",
                "  -m, --memory   Inspect state.memory structure",
                "  -s, --state    Inspect active state keys and types",
                "  -i, --info     Inspect info object (model settings, maxChars)",
                "  -a, --all      Full diagnostic dump of state and environment",
                "Self-Test Sub-Flags (with --test):",
                "  --verbose      Display detailed individual test descriptions",
                "=================================================================="
            ].join("\n");
        }

        const engine = (typeof globalThis !== "undefined" && (globalThis.AIDGetopt || globalThis.GetoptAID))
            ? (globalThis.AIDGetopt || globalThis.GetoptAID)
            : (typeof api !== "undefined" ? api : null);

        // 2. Self-Test
        if (flags.test || sub === "test" || sub === "selftest") {
            if (!engine || typeof engine.selfTest !== "function") {
                return "⚠️ AID-Getopt selfTest engine not loaded.";
            }
            const report = engine.selfTest({ verbose: flags.verbose || flags.v });
            return report.formatted;
        }

        // 3. Diagnostics
        if (flags.diag || sub === "diag" || sub === "diagnostics" || flags.context || flags.memory || flags.state || flags.all) {
            const diagStr = (engine && typeof engine.diag === "function")
                ? engine.diag()
                : "AID-Getopt v1.0.0";
            const modules = [];
            if (typeof globalThis !== "undefined") {
                if (globalThis.AIDGetopt || globalThis.GetoptAID) modules.push("AIDGetopt");
                if (globalThis.GetoptSandbox) modules.push("GetoptSandbox");
                if (globalThis.AutoCards || globalThis.EntityCards) modules.push("EntityCards");
                if (globalThis.InnerEntity || globalThis.InnerSelf) modules.push("InnerEntity");
            }

            const lines = [
                "==================================================================",
                "  ⚙️ AID-Getopt System Diagnostics",
                "==================================================================",
                `  Parser:     ${diagStr}`,
                `  Lifecycle:  Multi-Tab Cooperative (Auto-Cards compatible)`,
                `  Modules:    ${modules.length ? modules.join(", ") : "AID-Getopt Standalone"}`,
                `  State Key:  state.GetoptSandbox`
            ];

            const st = (typeof state !== "undefined" ? state : context?.state);
            const inf = (typeof info !== "undefined" ? info : context?.info);

            const formatInspect = (label, val) => {
                if (val === undefined) return `  ${label}: (undefined)`;
                if (val === null) return `  ${label}: null`;
                if (typeof val === "string") return `  ${label}: "${val}" (${val.length} chars)`;
                if (typeof val !== "object") return `  ${label}: ${String(val)}`;
                try {
                    const json = JSON.stringify(val, null, 2);
                    return [
                        `  ${label}: (${Array.isArray(val) ? "Array[" + val.length + "]" : "Object"})`,
                        ...json.split("\n").map(l => "    " + l)
                    ].join("\n");
                } catch (_) {
                    return `  ${label}: [Object: ${Object.keys(val).join(", ")}]`;
                }
            };

            const showMemory = flags.memory || flags.all;
            const showInfo = flags.info || flags.all;
            const showState = flags.state || flags.all;
            const showContext = flags.context || flags.all;

            if (showMemory) {
                lines.push("------------------------------------------------------------------");
                lines.push("  🧠 state.memory Inspection:");
                if (!st) {
                    lines.push("  state: (undefined in current scope)");
                } else {
                    lines.push(formatInspect("state.memory", st.memory));
                }
            }

            if (showInfo) {
                lines.push("------------------------------------------------------------------");
                lines.push("  ℹ️ info Inspection (Settings & Model):");
                if (!inf) {
                    lines.push("  info: (undefined in current scope)");
                } else {
                    lines.push(formatInspect("info", inf));
                }
            }

            if (showState) {
                lines.push("------------------------------------------------------------------");
                lines.push("  📦 state Keys & Types:");
                if (!st) {
                    lines.push("  state: (undefined in current scope)");
                } else {
                    const keys = Object.keys(st);
                    lines.push(`  Keys (${keys.length}): ${keys.join(", ") || "(none)"}`);
                    for (const k of keys) {
                        if (k !== "GetoptSandbox") {
                            const val = st[k];
                            const t = Array.isArray(val) ? `Array[${val.length}]` : typeof val;
                            lines.push(`  • state.${k}: (${t})`);
                        }
                    }
                }
            }

            if (showContext) {
                lines.push("------------------------------------------------------------------");
                lines.push("  📜 Model Context Inspection:");
                const ctxLen = st?.GetoptSandbox?.lastContextLength || 0;
                const ctx = st?.GetoptSandbox?.lastContext;
                lines.push(`  Length: ${ctxLen} chars`);
                if (ctx) {
                    const preview = ctx.length > 400 ? ctx.slice(0, 400) + "..." : ctx;
                    lines.push("  Snippet:\n" + preview.split("\n").map(l => "    " + l).join("\n"));
                } else {
                    lines.push("  (No model context captured yet)");
                }
            }

            if (!showMemory && !showInfo && !showState && !showContext) {
                lines.push("------------------------------------------------------------------");
                lines.push("  Tip: Use '/aid-getopt --diag -c' to inspect context, or '-m' for memory");
            }

            lines.push("==================================================================");
            return lines.join("\n");
        }

        // 4. Version (or default overview if no flags)
        const infoObj = (engine && typeof engine.info === "function")
            ? engine.info()
            : { version: "1.0.0", gitHash: "unknown", buildTime: "unknown", environment: "AI Dungeon QuickJS" };

        return [
            "==================================================================",
            "  🎯 AID-Getopt Router & Parser Status",
            "==================================================================",
            `  Version:    v${infoObj.version}`,
            `  Git Commit: ${infoObj.gitHash}`,
            `  Build Time: ${infoObj.buildTime}`,
            `  Runtime:    ${infoObj.environment || "AI Dungeon QuickJS"}`,
            `  Registered: ${app.commands.size} commands configured`,
            "------------------------------------------------------------------",
            "  Commands:",
            "  • Run System Diagnostics: /aid-getopt --diag (or -c for context)",
            "  • Run Engine Self-Tests:  /aid-getopt --test",
            "  • View All Commands:      /help",
            "=================================================================="
        ].join("\n");
    }
});

// ============================================================================
// PART 3: AI DUNGEON LIFECYCLE HOOKS & SEQUENTIAL PIPELINE COOPERATION
// ============================================================================

/**
 * Master lifecycle entry point for the GetoptAID Sandbox.
 * Follows the standard AI Dungeon multi-tab contract (like Auto-Cards and Inner-Self).
 * 
 * @param {string} inHook - "input" | "context" | "output"
 * @param {string} inText - Current text string passed by AI Dungeon
 * @param {boolean} [inStop] - Current stop state (passed on context hook)
 * @returns {string|[string, boolean]} - Modified text, or [text, stop] on context
 */
function GetoptSandbox(inHook, inText, inStop) {
    const HOOK = inHook;
    const TEXT = (typeof inText === "string" ? inText : "");
    const STOP = (inStop === true);

    if (typeof state !== "undefined") {
        state.GetoptSandbox ??= {};
    }

    switch (HOOK) {
        case "input": {
            const result = app.dispatch(TEXT, {
                state: (typeof state !== "undefined" ? state : {}),
                info: (typeof info !== "undefined" ? info : {})
            });
            if (result.matched) {
                // Store command output for the output hook (story text).
                // In AI Dungeon, story text (Output) renders Markdown and preserves newlines,
                // whereas action text (Input) collapses newlines into spaces and strips Markdown.
                if (typeof state !== "undefined" && state.GetoptSandbox) {
                    state.GetoptSandbox.commandOutput = result.output || "\n";
                }
                return TEXT;
            }
            // Not our command: pass through untouched for downstream scripts or story engine
            return TEXT;
        }

        case "context": {
            if (typeof state !== "undefined" && state.GetoptSandbox) {
                state.GetoptSandbox.lastContextLength = TEXT.length;
                state.GetoptSandbox.lastContext = TEXT;
            }
            return [TEXT, STOP];
        }

        case "output": {
            if (typeof state !== "undefined" && state.GetoptSandbox && state.GetoptSandbox.commandOutput !== undefined) {
                const out = state.GetoptSandbox.commandOutput;
                delete state.GetoptSandbox.commandOutput;
                return out ? `${out.trim()}\n` : "\n";
            }
            return TEXT;
        }

        default:
            return TEXT;
    }
}

if (typeof globalThis !== "undefined") {
    globalThis.stop ??= false;
    globalThis.GetoptSandbox = GetoptSandbox;
}

// Standalone single-tab execution hook (when used directly in the Input Modifier tab)
const modifier = (text) => {
    text = GetoptSandbox("input", text);
    if (typeof state !== "undefined" && state.GetoptSandbox && state.GetoptSandbox.commandOutput !== undefined) {
        const out = state.GetoptSandbox.commandOutput;
        delete state.GetoptSandbox.commandOutput;
        return { text: out ? `${out.trim()}\n` : "\n" };
    }
    return { text };
};
modifier(typeof text !== "undefined" ? text : "");
