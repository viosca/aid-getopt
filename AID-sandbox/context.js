// ============================================================================
// Context Modifier (AID-sandbox/context.js)
//
// Paste this entire file into your scenario's "Context" tab.
// Halts the AI model on command turns to eliminate 100% of LLM churn!
// Requires: library-sandbox.js in the "Library" tab.
// ============================================================================
const modifier = (text) => {
    // If running alongside Auto-Cards or other scripts in RUN ORDER:
    // [text, stop] = AutoCards("context", text, stop);

    if (typeof GetoptSandbox === "function") {
        [text, stop] = GetoptSandbox("context", text, stop);
    }
    return { text, stop };
};
modifier(text);
