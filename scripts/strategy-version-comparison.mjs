// Compatibility entry point. The old comparison script had a separate
// execution model and could not be used as deployment evidence. All strategy
// comparisons now run through the shared engine and walk-forward gate.
import "./walk-forward-validation.mjs";
