// ============================================================================
//
//                             USE THIS VERSION
//
//                      AID-Getopt Library (Ver. 1.0.0)
//
//   Build Generation: 2026-11-11 05:12:29 UTC
//   Git Commit:       f4e216f
//   Repository:       https://github.com/viosca/aid-getopt
//   License:          MIT (c) Randy Viosca (@Random_Variable)
//
//   Paste this whole file as your ENTIRE "Library" tab in AI Dungeon.
//
//   If publishing as a standalone script module on AI Dungeon:
//   1. In scenario Details -> Player presentation -> toggle "Mark as Script" ON.
//   2. In Scripts -> Library tab, paste this file.
//   3. Now other creators can add AID-Getopt to their scenario RUN ORDER!
//
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
    const GIT_HASH = "f4e216f";
    const BUILD_TIME = "2026-11-11 05:12:29 UTC";

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
