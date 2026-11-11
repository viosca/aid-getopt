# GetoptAID Interactive Sandbox 🎲📦🛡️

An out-of-the-box playable AI Dungeon scenario demonstrating **GetoptAID** with real-world interactive slash commands:
- **`/roll`** — Polyhedral dice roller with modifiers, dice counts, and advantage/disadvantage.
- **`/inv`** — Persistent inventory system with array accumulators (`-a@`, `-d@`), gear equipping, and gold tracking.
- **`/stat`** — Character sheet manager with key-value hash accumulators (`--meta%`), trait tags (`-t@`), and HP/MP pools.
- **`/help`** — Automated command manual generator.

---

## 📁 Sandbox Directory Contents

| File | Purpose | AI Dungeon Location |
| :--- | :--- | :--- |
| **[`AI-Instruction.txt`](AI-Instruction.txt)** *(or [`.md`](AI-Instruction.md))* | System instructions guiding the AI GM to react naturally to dice rolls and inventory changes. | Scenario Editor ➔ **AI Instructions** |
| **[`Opening-Story.txt`](Opening-Story.txt)** *(or [`.md`](Opening-Story.md))* | Atmospheric opening adventure at the Crossroads Waystation with in-game command reference. | Scenario Editor ➔ **Prompt** |
| **[`sandbox-script.js`](sandbox-script.js)** | Complete, ready-to-paste script bundling GetoptAID + interactive commands + AID input hook. | Scenario Editor ➔ **Scripting** ➔ **Input** |

---

## 🚀 Setup Directions

You can run this sandbox in AI Dungeon using either of two approaches:

### Method 1: The Auto-Cards Multi-Tab Architecture (Recommended — Zero LLM Churn)

This matches the standard, battle-tested architecture used by **Auto-Cards** and **Inner-Self**. It uses the **Context** tab to halt the engine immediately on command turns, **preventing 100% of LLM churn**:

1. Open [AI Dungeon](https://play.aidungeon.com/) on desktop.
2. Click **Create** ➔ **New Scenario**.
3. Under **Scenario Details**:
   - Title: `GetoptAID Sandbox: The Crossroads`
   - Paste [`Opening-Story.txt`](Opening-Story.txt) into the **Prompt** field.
   - Paste [`AI-Instruction.txt`](AI-Instruction.txt) into the **AI Instructions** field.
4. Click **Scripting** (toggle **Scripts Enabled** to ON):
   - **Library Tab:** Paste the entire contents of [`library-sandbox.js`](library-sandbox.js).
   - **Input Tab:** Paste [`input.js`](input.js).
   - **Context Tab:** Paste [`context.js`](context.js).
   - **Output Tab:** Paste [`output.js`](output.js).
5. Click **Save** and click **Play**!

---

### Method 2: Single-Tab Quick Test (Input Only)

If you only want to test commands in a single tab without modifying Context or Output:
1. In the **Input** tab, paste [`sandbox-script.js`](sandbox-script.js).
2. Leave other tabs at their defaults.
*(Note: Because this method only runs in the Input hook, AI Dungeon will run a normal narrative continuation turn after your command output).*

---

### Method 3: Using the AID Script Loader & Multi-Script Pipeline

AI Dungeon supports a **multi-script execution pipeline**, allowing scenario creators and adventure players to stack multiple independent scripts that run in sequence:

```
Player Input (e.g. "/roll -d 20" or "/ec -p Molly")
                     │
                     ▼
  ┌────────────────────────────────────────┐
  │  Script 1: GetoptAID Sandbox           │
  │  - Matches /roll, /inv, /stat          │
  │  - Unmatched input: { matched: false } ──┐ (Passthrough)
  └──────────────────┬─────────────────────┘  │
                     │ (Handled)              │
                     ▼                        ▼
               Display Output     ┌────────────────────────────────────────┐
                                  │  Script 2: Entity Cards / Auto-Cards   │
                                  │  - Matches /ec, /ac                    │
                                  │  - Unmatched input: { matched: false } ──┐
                                  └──────────────────┬─────────────────────┘  │
                                                     │ (Handled)              │
                                                     ▼                        ▼
                                               Generate Card       ┌──────────────────────┐
                                                                   │ AI Dungeon AI Engine │
                                                                   │ (Story Generation)   │
                                                                   └──────────────────────┘
```

#### How to Add to a Multi-Script Adventure:
1. Open your existing adventure or scenario with other scripts already installed (e.g. **Entity Cards**, **Inner Entity**, or a combat engine).
2. In the **Scripting** manager, add `sandbox-script.js` as an additional script in the execution waterfall.
3. Because GetoptAID uses **Layer 2 non-interfering routing**, it only consumes commands registered to it (`/roll`, `/inv`, `/stat`, `/help`).
4. Any unrecognized commands (such as `/ec -p CharacterName` or `/ac info`) or normal story narrative (`You draw your sword`) return `{ matched: false }` immediately, allowing downstream scripts in your pipeline to execute with **zero collisions and zero interference**.

#### For Adventure Players:
Adventure players can also enable their own client scripts (such as personal dice rollers or status trackers) without overriding a scenario creator's custom scripts. GetoptAID ensures both run in harmony!

---

## 🎮 In-Game Testing & Commands

Once playing, try typing these commands in the action bar:

### 1. Rolling Dice (`/roll` or `/r`)
- `/roll -d 20 -m 4` — Roll a d20 with a +4 modifier.
- `/roll -c 3 -d 6` — Roll three 6-sided dice.
- `/roll -d 20 -a` — Roll with advantage (rolls twice, takes highest).
- `/roll -d 20 --dis` — Roll with disadvantage (rolls twice, takes lowest).
- `You say, "/roll -d 20."` — Natural dialogue quoting unwraps automatically!
- `/roll —d 20` — Mobile em-dashes (`—`) are normalized seamlessly.

### 2. Managing Inventory (`/inv` or `/i`)
- `/inv -l` — View your current pack, equipped gear, and gold.
- `/inv -a "Steel Dagger" -a "Healing Draught"` — Add multiple items in one command using array accumulators!
- `/inv -e "Steel Dagger"` — Equip an item from your pack.
- `/inv -g 50` — Add 50 gold coins (`/inv -g -15` to spend).
- `/inv -d "Healing Draught"` — Drop an item.

### 3. Updating Character Status (`/stat` or `/s`)
- `/stat -v` — View your character sheet.
- `/stat --hp 85 --mp 40` — Update current health and mana.
- `/stat -t "stealthy" -t "bilingual"` — Add character traits.
- `/stat --meta Class=Ranger --meta Level=3` — Assign custom key-value metadata using hash accumulators.

### 4. In-Game Self-Test Diagnostic (`/test` or `/check`)
- `/test` — Kick the tires! Executes the in-engine 10-point self-test directly inside AI Dungeon's QuickJS environment, reporting live status on option parsing, typed specs, mobile dashes, and pipeline routing.
- `/test -v` — Run self-test in verbose mode.

### 5. Help Reference
- `/help` — Output the full command manual.
- `/roll -h` or `/inv -?` — View flag documentation for specific commands.

---

## 🛠️ Adding Your Own Custom Commands

Adding a new slash command to `sandbox-script.js` takes only a few lines using `app.command()`:

```javascript
app.command("weather", {
    aliases: ["w"],
    description: "Check or change the current weather",
    options: {
        "set|s=s": null,  // String option: /weather -s rain
        "temp|t=i": 68    // Integer option: /weather -t 75
    },
    action: (flags, operands, target) => {
        if (flags.set) {
            return `🌦️ Weather changed to ${flags.set} (${flags.temp}°F).`;
        }
        return `🌦️ The current weather is brisk and clear (${flags.temp}°F).`;
    }
});
```

---

## 🧪 Verification

To run automated unit tests verifying the sandbox script inside a mock AI Dungeon VM:

```bash
npm test
```
