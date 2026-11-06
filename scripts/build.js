#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const SRC_PATH = path.join(ROOT_DIR, "src", "getopt-aid.js");
const OUTPUT_LIB_PATH = path.join(ROOT_DIR, "library-getopt-aid.js");
const SANDBOX_SCRIPT_PATH = path.join(ROOT_DIR, "AID-sandbox", "sandbox-script.js");
const PKG_PATH = path.join(ROOT_DIR, "package.json");

function getGitHash(dir) {
    try {
        return execSync("git rev-parse --short HEAD", { cwd: dir, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch (_) {
        return "unknown";
    }
}

function getTimestamp() {
    return new Date().toISOString().replace("T", " ").replace(/\..+/, "") + " UTC";
}

function main() {
    console.log("==================================================================");
    console.log("  BUILDING GetoptAID Distribution Artifacts");
    console.log("==================================================================");

    if (!fs.existsSync(SRC_PATH)) {
        console.error(`Error: Source file not found at ${SRC_PATH}`);
        process.exit(1);
    }

    const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf8"));
    const version = pkg.version || "1.0.0";
    const gitHash = getGitHash(ROOT_DIR);
    const timestamp = getTimestamp();

    console.log(`   Version:    ${version}`);
    console.log(`   Git Commit: ${gitHash}`);
    console.log(`   Build Time: ${timestamp}`);

    const rawSrc = fs.readFileSync(SRC_PATH, "utf8");

    // Replace dev placeholders with actual build metadata
    let stamped = rawSrc
        .replace(/const GIT_HASH = "[^"]*";/, `const GIT_HASH = "${gitHash}";`)
        .replace(/const BUILD_TIME = "[^"]*";/, `const BUILD_TIME = "${timestamp}";`);

    // Create official AID Library header banner
    const banner = `// ============================================================================
//
//                             USE THIS VERSION
//
//                      GetoptAID Library (Ver. ${version})
//
//   Build Generation: ${timestamp}
//   Git Commit:       ${gitHash}
//   Repository:       https://github.com/viosca/getopt-aid
//   License:          MIT (c) Randy Viosca (@Random_Variable)
//
//   Paste this whole file as your ENTIRE "Library" tab in AI Dungeon.
//
//   If publishing as a standalone script module on AI Dungeon:
//   1. In scenario Details -> Player presentation -> toggle "Mark as Script" ON.
//   2. In Scripts -> Library tab, paste this file.
//   3. Now other creators can add GetoptAID to their scenario RUN ORDER!
//
// ============================================================================

`;

    const finalLibraryCode = banner + stamped;

    // Syntax validation
    try {
        new vm.Script(finalLibraryCode);
        console.log("   ✔ Syntax validation passed for library-getopt-aid.js");
    } catch (err) {
        console.error("   ✖ Syntax validation FAILED for library-getopt-aid.js:", err);
        process.exit(1);
    }

    // Write library-getopt-aid.js
    fs.writeFileSync(OUTPUT_LIB_PATH, finalLibraryCode, "utf8");
    const libLines = finalLibraryCode.split("\n").length;
    const libKb = (Buffer.byteLength(finalLibraryCode, "utf8") / 1024).toFixed(1);
    console.log(`   ✔ Wrote library-getopt-aid.js (${libLines.toLocaleString()} lines, ${libKb} KB)`);

    // Update AID-sandbox/sandbox-script.js embedded engine if it exists
    if (fs.existsSync(SANDBOX_SCRIPT_PATH)) {
        let sandboxCode = fs.readFileSync(SANDBOX_SCRIPT_PATH, "utf8");
        const part1Regex = /(\/\/ =+\r?\n\/\/ PART 1: EMBEDDED GetoptAID ENGINE[\s\S]*?\r?\n\/\/ =+\r?\n)[\s\S]*?(\r?\n\/\/ =+\r?\n\/\/ PART 2: COMMAND DEFINITIONS)/;
        
        if (part1Regex.test(sandboxCode)) {
            sandboxCode = sandboxCode.replace(part1Regex, `$1${stamped}$2`);
            try {
                new vm.Script(sandboxCode);
                fs.writeFileSync(SANDBOX_SCRIPT_PATH, sandboxCode, "utf8");
                console.log("   ✔ Synchronized stamped engine into AID-sandbox/sandbox-script.js");
            } catch (err) {
                console.error("   ⚠️ Could not sync sandbox-script.js syntax:", err);
            }
        }
    }

    console.log("==================================================================");
    console.log("  🎉 BUILD COMPLETE!");
    console.log("==================================================================");
}

main();
