// ============================================================================
// Input Modifier (AID-sandbox/input.js)
//
// Paste this entire file into your scenario's "Input" tab.
// Requires: library-sandbox.js in the "Library" tab.
// ============================================================================
const modifier = (text) => {
    // If running alongside Auto-Cards or other scripts in RUN ORDER:
    // text = AutoCards("input", text);

    if (typeof GetoptSandbox === "function") {
        text = GetoptSandbox("input", text);
    } else {
        console.log("⚠️ [Input Hook] GetoptSandbox is NOT defined! The Shared Library tab is empty or not loaded.");
    }
    return { text };
};
modifier(text);
