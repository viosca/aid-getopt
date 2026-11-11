// ============================================================================
// Input Modifier (examples/input.js)
//
// Paste this entire file into your scenario's "Input" tab.
// Requires: library-sandbox.js in the "Library" tab.
// ============================================================================
const modifier = (text) => {
    // If running alongside Auto-Cards or other scripts in RUN ORDER:
    // text = AutoCards("input", text);

    if (typeof GetoptSandbox === "function") {
        text = GetoptSandbox("input", text);
    }
    return { text };
};
modifier(text);
