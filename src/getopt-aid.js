/**
 * GetoptAID - POSIX/GNU-Style Option Parser & Multi-Script Slash Command Router for AI Dungeon
 *
 * Architecture:
 * - Layer 1: Core Option Parser (GetoptAID.getopt / GetoptAID.parse)
 *   POSIX & GNU-style option parsing, Perl-style compact specs ("mode|m=s", "tags|t=s@"),
 *   array/hash accumulators, closures/action callbacks, and mobile typography tolerance.
 * - Layer 2: Command Router & Multi-Script Dispatcher (GetoptAID.cli / GetoptAID.CLI)
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
        root.GetoptAID = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
    "use strict";

    const VERSION = "1.0.0";

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
        // AID dialogue wrapper: e.g. > You say, "..." or Joe says, "..."
        const sayMatch = str.match(/(?:^|\n)(?:>\s*)?(?:You|[A-Za-z0-9_]+)\s*(?:says?|asks?|exclaims?|shouts?),?\s*["“]([\s\S]*?)["”][\s.!?]*$/i);
        if (sayMatch) {
            str = sayMatch[1].trim();
        }
        // Clean trailing speech/sentence punctuation at end of command (preserving -? and closing quotes)
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
            // Dialogue wrapper unpacking (Say/Do mode)
            const sayMatch = str.match(/(?:^|\n)(?:>\s*)?(?:You|[A-Za-z0-9_]+)\s*(?:says?|asks?|exclaims?|shouts?),?\s*["“]([\s\S]*?)["”][\s.!?]*$/i);
            if (sayMatch) {
                str = sayMatch[1].trim();
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

    const api = {
        version: VERSION,
        // Layer 1: Core Option Parser
        tokenize,
        getopt,
        parse: getopt,
        getoptLong: getopt,
        compileSpec,
        // Layer 2: Command Router
        CLI: Router,
        Router,
        cli
    };

    // Safe global environment registration for AI Dungeon scripts
    if (typeof globalThis !== "undefined") {
        if (!globalThis.GetoptAID || globalThis.GetoptAID.version < VERSION) {
            globalThis.GetoptAID = api;
        }
    }

    return api;
});
