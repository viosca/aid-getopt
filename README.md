# GetoptAID 🎯

[![Node.js CI](https://img.shields.io/badge/tests-100%25%20passing-brightgreen.svg)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-success.svg)]()

> Lightweight POSIX/GNU option parser and multi-script slash-command router built specifically for **AI Dungeon** and interactive fiction scripting.

**GetoptAID** brings the power and expressive ergonomics of Perl's `Getopt::Long` to AI Dungeon scripting. It is designed from the ground up to solve the real-world friction of mobile keyboards, character name collisions, and AI Dungeon's **sequential multi-script execution pipeline**.

---

## 🌟 Why GetoptAID?

AI Dungeon scripting presents unique challenges that standard desktop CLI parsers cannot handle:

1. **Multi-Script Execution Waterfall**: AI Dungeon allows scenario creators and adventure players to stack multiple independent scripts (e.g. a dice roller + an inventory tracker + a lore engine). If a script aggressively hijacks or crashes on unfamiliar input, downstream scripts never receive their commands. GetoptAID provides **non-interfering passthrough** (`{ matched: false }`), ensuring seamless multi-creator script harmony.
2. **Mobile Typography Tolerance**: Mobile keyboards automatically convert `--` into em-dashes (`—`) or en-dashes (`–`), and straight quotes into curly quotes (`“` `”`). GetoptAID normalizes all smart punctuation before parsing.
3. **Dialogue Quoting**: Players frequently type slash commands inside dialogue quotes (e.g. `Joe says, "/ec -p Molly."` or `> You say, "/roll -d 20"`). GetoptAID unrolls the speech envelope, strips sentence-ending punctuation, and leaves narrative text intact.
4. **Name Collisions**: Bareword subcommands (`/ec mode Molly`) cause fatal ambiguity when an adventure has a character, faction, or item named "Mode", "Preset", or "Help". POSIX/GNU flags (`-m`, `--mode`) eliminate this ambiguity completely.
5. **Zero Dependencies**: Single clean file (`~460` lines of pure JavaScript) with zero runtime dependencies. Runs identically in Node.js, the AI Dungeon browser sandbox, or bundled with Webpack / esbuild / Rollup.

---

## 🏗️ Architecture: Two Decoupled Layers

GetoptAID is split into two independent layers to fit any script design:

```
┌──────────────────────────────────────────────────────────────────┐
│  Raw Input (e.g. Joe says, "/ec -m dynamic --preset Molly".)     │
└─────────────────────────────────┬────────────────────────────────┘
                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│  Layer 2: Multi-Script Command Router (GetoptAID.cli)            │
│  - Unwraps dialogue wrappers                                     │
│  - Matches registered slash command (/ec)                        │
│  - PASSES THROUGH unrecognized commands ({ matched: false })      │
└─────────────────────────────────┬────────────────────────────────┘
                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│  Layer 1: Core Option Parser (GetoptAID.getopt)                  │
│  - Normalizes smart dashes (—, –) and smart quotes (“ ”)          │
│  - Parses POSIX short flags (-v, -m) & GNU long flags (--mode)    │
│  - Supports Perl-style compact specs ("mode|m=s", "tags|t=s@")   │
│  - Executes Perl-style action closures & accumulators (@, %)     │
│  - Respects '--' end-of-options delimiter                        │
└──────────────────────────────────────────────────────────────────┘
```

- **Layer 1 (`GetoptAID.getopt`)**: For scripts that only need options parsing for a single command or custom input. Does not care about slash prefixes or subcommands.
- **Layer 2 (`GetoptAID.cli`)**: For comprehensive scripting suites with multiple slash commands, subcommands, aliases, help generators, and multi-script pipeline passthrough.

---

## 🚀 Installation

### Option A: As a Git Submodule (Recommended)
Add GetoptAID as a submodule inside your AI Dungeon project:
```bash
git submodule add https://github.com/viosca/getopt-aid.git submodules/getopt-aid
```

### Option B: Direct Copy
Copy `src/getopt-aid.js` directly into your repository's `lib/` directory or bundle it with your script build pipeline.

---

## 📖 Usage Examples

### 1. Layer 1: Standalone Option Parsing
If you already have your own command handler and just want POSIX/GNU option parsing:

```javascript
const { getopt } = require("getopt-aid"); // or globalThis.GetoptAID

const spec = {
    "mode|m=s":    "dynamic",     // String option with alias -m, default "dynamic"
    "preset|p=s":  null,          // String option with alias -p
    "verbose|v+":  0,             // Counter: -v => 1, -vv => 2
    "tags|t=s@":   [],            // Array accumulator: -t fire -t magic
    "meta=s%":     {},            // Hash accumulator: --meta hp=100 --meta mp=50
    "help|h|?":    false          // Boolean flag with aliases -h and -?
};

const input = '-m raw -vv -t fire -t magic --meta hp=100 "Molly"';
const result = getopt(input, spec);

console.log(result.flags);
// {
//   mode: 'raw',
//   preset: null,
//   verbose: 2,
//   tags: [ 'fire', 'magic' ],
//   meta: { hp: '100' },
//   help: false
// }

console.log(result.target);   // 'Molly'
console.log(result.operands); // ['Molly']
```

---

### 2. Layer 2: Multi-Command Slash Router
Build a complete slash-command suite with multiple commands:

```javascript
const { cli } = require("getopt-aid");

const app = cli();

// Register a dice roller
app.command("roll", {
    aliases: ["r", "dice"],
    description: "Roll dice with modifiers",
    options: {
        "dice|d=i": 20,
        "modifier|m=i": 0,
        "secret|s": false
    },
    action: (flags, operands, target) => {
        const roll = Math.floor(Math.random() * flags.dice) + 1;
        const total = roll + flags.modifier;
        return `Rolled d${flags.dice}${flags.modifier ? `+${flags.modifier}` : ""}: ${total}`;
    }
});

// Register an entity cards command
app.command("ec", {
    aliases: ["card", "cards"],
    description: "Entity Cards manager",
    options: {
        "mode|m=s": "dynamic",
        "preset|p=s": null,
        "header=s": null,
        "raw|r": false
    },
    action: (flags, operands, target) => {
        return `EC [${flags.mode}] Target: ${target || "(none)"}`;
    }
});

// Dispatch player input (works with dialogue quotes and mobile dashes!)
const res = app.dispatch('Joe says, "/roll -d 6 -m 2."');
console.log(res.matched); // true
console.log(res.output);  // "Rolled d6+2: 7"
```

---

### 3. AI Dungeon Sequential Multi-Script Pipeline
In AI Dungeon, multiple scripts run in a waterfall. When a command is not meant for your script, GetoptAID cleanly returns `{ matched: false }` so other scripts can handle it:

```javascript
// In your AI Dungeon onInput modifier script:
const app = GetoptAID.cli();

app.command("mycmd", {
    action: (flags, operands) => {
        state.myScriptMessage = "Executed mycmd!";
        return ""; // Clear input so it doesn't appear in story prose
    }
});

// Dispatch the user input:
const result = app.dispatch(text);

if (result.matched) {
    // Our command was handled!
    text = ""; // Consume the command
    return { text };
}

// NOT our command! Let other creators' scripts downstream process it:
// (e.g. Another creator's dice roller or inventory script will now receive 'text')
return { text };
```

---

### 4. Perl-Style Action Closures
Attach validation or immediate side-effects directly to options in the spec:

```javascript
const spec = {
    "scale=i": (optName, val, flags) => {
        if (val < 1 || val > 100) {
            throw new Error(`--${optName} must be between 1 and 100 (got ${val})`);
        }
        flags[optName] = val;
    },
    "clear": (optName, val, flags) => {
        flags.cleared = true;
        return "Cache cleared successfully.";
    }
};

const result = GetoptAID.getopt("--scale 50 --clear", spec);
console.log(result.flags.scale);   // 50
console.log(result.flags.cleared); // true
console.log(result.output);        // "Cache cleared successfully."
```

---

## 📋 Perl `Getopt::Long` Spec Cheat Sheet

| Spec Pattern | Type | Example Flag | Parsed Value | Description |
| :--- | :--- | :--- | :--- | :--- |
| `"help\|h\|?"` | Boolean | `-h`, `-?`, `--help` | `true` | Boolean switch with short and alternative aliases |
| `"color!"` | Negatable | `--no-color` | `false` | Prefixing with `no-` sets flag to `false` |
| `"verbose\|v+"`| Counter | `-vvv` | `3` | Increments for each occurrence |
| `"mode\|m=s"` | Required String | `-m raw`, `--mode=raw` | `"raw"` | `=s` expects a required string argument |
| `"port\|p=i"` | Required Int | `-p 8080`, `--port=8080` | `8080` | `=i` parses and validates integer |
| `"notes:s"` | Optional String | `--notes` or `--notes="foo"` | `true` or `"foo"` | `:s` optional argument; defaults to `true` if omitted |
| `"tag\|t=s@"` | Array Accumulator | `-t fire -t magic` | `["fire", "magic"]` | `@` appends every occurrence into an array |
| `"meta=s%"` | Hash Accumulator | `--meta hp=100 --meta mp=50` | `{ hp: "100", mp: "50" }` | `%` parses `key=val` pairs into an object |

---

## 📱 Mobile Keyboard & Typographic Normalization

GetoptAID transparently handles mobile typing artifacts:
- **Dashes**: `—` (em-dash) and `–` (en-dash) are converted to `--` and `-`.
- **Quotes**: `“`, `”`, `‘`, `’` are converted to standard `"` and `'`.
- **Dialogue Unwrapping**: `Joe says, "/cmd -flag"` is automatically unwrapped to `/cmd -flag`.
- **Trailing Punctuation**: Sentence periods, question marks, and exclamation marks outside quotes are stripped so `> You say, "/help."` executes `--help` cleanly.
- **End-of-Options Delimiter**: POSIX standard `--` stops option processing, treating all following arguments as literal operands.

---

## 🧪 Testing & In-Game Diagnostics

### In-Game Self-Test (`/test` or `GetoptAID.selfTest()`)
GetoptAID includes a built-in diagnostic test runner that can execute directly inside AI Dungeon's QuickJS sandbox to kick the tires and verify all parser functions, mobile dash normalization, and multi-script routing:

```javascript
// Run programmatically:
const report = GetoptAID.selfTest();
console.log(report.formatted);

// Or via in-game slash command:
// Player types: /test
```

### Local Automated Test Suite
Run the 100% passing test suite across both Layer 1, Layer 2, and the AID Sandbox:

```bash
npm test
```

```
==================================================================
  TEST SUITE: GetoptAID (Layer 1 Option Parser & Layer 2 Router)
==================================================================

--- Part 1: Layer 1 Core Option Parser ---
   ✔ Boolean flags and Perl '+' counter modifier passed
   ✔ Perl-style typed specs (=s, =i, :s optional) passed
   ✔ Perl-style array accumulator (@) and hash accumulator (%) passed
   ✔ Perl-style closures and output string capture passed
   ✔ Mobile smart dashes (—, –) and curly quotes (“ ”) normalized
   ✔ POSIX '--' delimiter stops option parsing

--- Part 2: Layer 2 Multi-Script Command Router ---
   ✔ Command router registered, parsed options via Layer 1, and executed action
   ✔ Dialogue unwrapping across Say/Do quotes and aliases verified
   ✔ Unrecognized slash commands and story prose cleanly pass through (matched: false)
   ✔ AI Dungeon multi-script pipeline simulation passed with 100% harmony

--- Part 3: In-Engine selfTest() Diagnostic Verification ---
   ✔ GetoptAID.selfTest() executed cleanly with 100% success

==================================================================
  TESTING AID-SANDBOX SCRIPT INTEGRATION
==================================================================
   ✔ /roll -d 20 -m 4 executed and formatted cleanly
   ✔ /roll -d 20 -a (Advantage) rolled twice and kept highest
   ✔ /roll —d 12 —m 2 (Mobile em-dashes) normalized and parsed
   ✔ You say, "/roll -d 6 -m 1" dialogue wrapper unwrapped
   ✔ /inv array accumulators (-a@), equipment (-e), and gold (-g) verified
   ✔ /stat hash accumulators (--meta%), trait tags (-t@), and HP verified
   ✔ /help master reference generated
   ✔ /test in-game self-diagnostic suite executed with 100% success
   ✔ Unrecognized /ec command passed through untouched for downstream scripts
   ✔ Narrative story prose passed through untouched to AI Dungeon engine
==================================================================
  🎉 ALL UNIT & SANDBOX TESTS PASSED (100% SUCCESS)
==================================================================
```

---

## 🎮 Playable Scenario Sandbox

Check out the [`AID-sandbox/`](AID-sandbox/) folder for a ready-to-play AI Dungeon scenario:
- **`AI-Instruction.txt`**: Guide the AI GM to react dynamically to rolls and inventory.
- **`Opening-Story.txt`**: Atmospheric crossroads tavern prompt with in-game command reference.
- **`sandbox-script.js`**: Complete ready-to-paste script with `/roll`, `/inv`, `/stat`, `/test`, and `/help`.
- **`README.md`**: Step-by-step instructions for standalone play or stacking in the AI Dungeon Script Loader.

---

## 📄 License

MIT © Randy Viosca ([@Random_Variable](https://github.com/viosca))
