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
(function(root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.GetoptAID = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
    "use strict";

    const VERSION = "1.0.0";

    function tokenize(input) {
        if (!input || typeof input !== "string") return [];
        let str = input.trim();
        const sayMatch = str.match(/(?:^|\n)(?:>\s*)?(?:You|[A-Za-z0-9_]+)\s*(?:says?|asks?|exclaims?|shouts?),?\s*["“]([\s\S]*?)["”][\s.!?]*$/i);
        if (sayMatch) {
            str = sayMatch[1].trim();
        }
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

    function compileSpec(rawSpec) {
        const normalized = {};
        for (const [keyPattern, rawDef] of Object.entries(rawSpec || {})) {
            let def = (typeof rawDef === "function")
                ? { action: rawDef }
                : (typeof rawDef === "object" && rawDef !== null)
                    ? Object.assign({}, rawDef)
                    : { default: rawDef };

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
                } else if (modifier === "!") {
                    def.type = "boolean";
                    def.negatable = true;
                } else if (modifier === "+") {
                    def.type = "counter";
                    def.default ??= 0;
                }

                if (container === "@") {
                    def.container = "array";
                    def.default = Array.isArray(def.default) ? def.default : [];
                } else if (container === "%") {
                    def.container = "hash";
                    def.default = (typeof def.default === "object" && def.default !== null) ? def.default : {};
                }
            }

            def.canonical = canonicalName;
            def.short = short;
            def.aliases = aliases;
            normalized[canonicalName] = def;
        }
        return normalized;
    }

    function getopt(input, rawSpec = {}) {
        const tokens = Array.isArray(input)
            ? input.map(t => (typeof t === "string" ? { text: t, isQuoted: false } : t))
            : tokenize(input);

        const compiled = compileSpec(rawSpec);
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
            if (def.negatable) {
                lookupLower.set(`--no-${key.toLowerCase()}`, { key, def, negate: true });
                lookupLower.set(`--no${key.toLowerCase()}`, { key, def, negate: true });
            }
        }

        const flags = {};
        const operands = [];
        const errors = [];
        let output = "";
        let endOfOptions = false;

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

            if (/^[—–]/.test(text)) {
                text = text.replace(/^[—–]{2}/, "--").replace(/^[—–]/, "-");
            }

            const cleanFlag = (text === "-?" || text === "--?") ? text : text.replace(/(?<=\w)[.!?,;:"”'’)]+$/, "");

            if (!cleanFlag.startsWith("-")) {
                operands.push(text);
                continue;
            }

            let flagName = cleanFlag;
            let inlineVal = null;
            const eqIdx = cleanFlag.indexOf("=");
            if (eqIdx !== -1) {
                flagName = cleanFlag.slice(0, eqIdx);
                inlineVal = cleanFlag.slice(eqIdx + 1).replace(/^["“'’]|["”'’]$/g, "");
            }

            let matched = lookupExact.get(flagName) || lookupLower.get(flagName.toLowerCase());

            if (!matched) {
                operands.push(text);
                continue;
            }

            const { key, def, negate } = matched;
            const optType = def.type || "boolean";

            if (optType === "counter") {
                flags[key] = (flags[key] || 0) + 1;
                if (typeof def.action === "function") {
                    const ret = def.action(flags[key], key);
                    if (typeof ret === "string") output += ret;
                }
                continue;
            }

            if (optType === "boolean") {
                flags[key] = negate ? false : true;
                if (typeof def.action === "function") {
                    const ret = def.action(flags[key], key);
                    if (typeof ret === "string") output += ret;
                }
                continue;
            }

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

            let parsedVal = val;
            if (optType === "number" && val !== true) {
                const num = Number(val);
                parsedVal = isNaN(num) ? val : num;
            } else if (optType === "string" && val !== true) {
                parsedVal = String(val);
            }

            if (def.container === "array") {
                flags[key] = Array.isArray(flags[key]) ? flags[key] : [];
                flags[key].push(parsedVal);
            } else if (def.container === "hash") {
                flags[key] = (typeof flags[key] === "object" && flags[key] !== null) ? flags[key] : {};
                const pairStr = String(parsedVal);
                const pEq = pairStr.indexOf("=");
                if (pEq !== -1) {
                    flags[key][pairStr.slice(0, pEq).trim()] = pairStr.slice(pEq + 1).trim();
                } else {
                    flags[key][pairStr.trim()] = true;
                }
            } else {
                flags[key] = parsedVal;
            }

            if (typeof def.action === "function") {
                const actionRet = def.action(parsedVal, key, flags);
                if (typeof actionRet === "string") {
                    output += (output ? "\n" : "") + actionRet;
                }
            }
        }

        return {
            flags,
            operands,
            target: operands.join(" ").trim(),
            output: output.trim(),
            errors,
            hasFlag: (name) => flags[name] !== undefined && flags[name] !== false
        };
    }

    class Router {
        constructor() {
            this.commands = new Map();
        }

        command(name, config = {}) {
            const cmdName = name.toLowerCase().replace(/^\/+/, "");
            const def = {
                name: cmdName,
                aliases: (config.aliases || []).map(a => a.toLowerCase().replace(/^\/+/, "")),
                description: config.description || "",
                options: config.options || {},
                action: config.action || null
            };
            this.commands.set(cmdName, def);
            for (const alias of def.aliases) {
                this.commands.set(alias, def);
            }
            return this;
        }

        dispatch(input, context = {}) {
            if (!input || typeof input !== "string") {
                return { matched: false, text: input };
            }

            let str = input.trim();
            const sayMatch = str.match(/(?:^|\n)(?:>\s*)?(?:You|[A-Za-z0-9_]+)\s*(?:says?|asks?|exclaims?|shouts?),?\s*["“]([\s\S]*?)["”][\s.!?]*$/i);
            if (sayMatch) {
                str = sayMatch[1].trim();
            }

            const cmdMatch = str.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*)|$)/);
            if (!cmdMatch) {
                return { matched: false, text: input };
            }

            const cmdName = cmdMatch[1].toLowerCase();
            const restArgs = cmdMatch[2] || "";

            if (!this.commands.has(cmdName)) {
                return { matched: false, text: input };
            }

            const cmdDef = this.commands.get(cmdName);
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

        help() {
            let out = "Available Commands:\n";
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

    function cli() {
        return new Router();
    }

    const api = {
        version: VERSION,
        tokenize,
        getopt,
        parse: getopt,
        getoptLong: getopt,
        compileSpec,
        CLI: Router,
        Router,
        cli
    };

    if (typeof globalThis !== "undefined") {
        if (!globalThis.GetoptAID || globalThis.GetoptAID.version < VERSION) {
            globalThis.GetoptAID = api;
        }
    }

    return api;
});

// ============================================================================
// PART 2: COMMAND DEFINITIONS & ROUTER CONFIGURATION
// ============================================================================

const app = (typeof globalThis !== "undefined" && globalThis.GetoptAID)
    ? globalThis.GetoptAID.cli()
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
        return `🎲 [DICE ROLL]\nRolled ${count}d${sides}${modStr}:${rollList} = **${total}**`;
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
            out.push(logs.join("\n"));
        }

        out.push("📦 [INVENTORY]");
        out.push(`• Equipped: ${inv.equipped || "(none)"}`);
        out.push(`• Pack: ${inv.items.length ? inv.items.join(", ") : "(empty)"}`);
        out.push(`• Gold: ${inv.gold} coins`);

        return out.join("\n");
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
            "🛡️ [CHARACTER STATUS]",
            `• ${metaParts || "Class: Adventurer"}`,
            `• Health: ${char.hp}/${char.maxHp} HP  |  Mana: ${char.mp}/${char.maxMp} MP`,
            `• Traits: ${char.tags.join(", ") || "(none)"}`
        ].join("\n");
    }
});

// Command 4: /help - Master Help Generator
app.command("help", {
    aliases: ["h", "?"],
    description: "Display command manuals and examples",
    action: (flags, operands, target) => {
        return [
            "==================================================================",
            "  🎯 GetoptAID Sandbox Command Center",
            "==================================================================",
            app.help(),
            "Tips:",
            "  • Type '/<cmd> --help' for options on any command (e.g. /roll -h)",
            "  • Commands work in Do, Say, or Story mode",
            "  • Normal speech & story prose pass through untouched to other scripts!",
            "=================================================================="
        ].join("\n");
    }
});

// ============================================================================
// PART 3: AI DUNGEON LIFECYCLE HOOKS & SEQUENTIAL PIPELINE COOPERATION
// ============================================================================

/**
 * AI Dungeon Input Modifier Hook
 * 
 * Multi-Script Waterfall Rule:
 * 1. If input matches one of our commands (/roll, /inv, /stat, /help), we execute
 *    it, display the command output to the player, and consume the command.
 * 2. If input does NOT match one of our commands (e.g. normal narrative or another
 *    creator's slash command like /ec), GetoptAID returns { matched: false } and
 *    we pass the text through completely untouched so downstream scripts can run!
 */
const modifier = (text) => {
    if (!text || typeof text !== "string") {
        return { text };
    }

    // Pass execution context containing AI Dungeon's state
    const result = app.dispatch(text, {
        state: (typeof state !== "undefined" ? state : {}),
        info: (typeof info !== "undefined" ? info : {})
    });

    if (result.matched) {
        // Our command was handled!
        // Output result cleanly as a system message in the adventure
        const outputMsg = result.output ? `\n\n${result.output}\n\n` : "";
        return {
            text: outputMsg,
            message: result.output || ""
        };
    }

    // Not our command! Pass text through untouched for downstream scripts or story engine:
    return { text };
};

// Standard AI Dungeon execution export
if (typeof text !== "undefined") {
    const res = modifier(text);
    if (res && res.text !== undefined) {
        text = res.text;
    }
}
