## Data-app throttling feedback

These data-app-specific instructions supplement the shared loading and failure
guidance above.

Detect throttling with `isThrottlingError` from `@/lib/semantic-model-errors`.
When `result.status === "refresh-error"` and `isThrottlingError(result.error)`,
keep the previous visual visible and show a persistent, accessible warning
beside it. Explain that the update was throttled and the retained results do
not reflect the latest interaction. Keep the warning visible until a successful
replacement load; do not rely on a transient toast.

Keep the retained data and its highlight flag together, and preserve accepted
selections. With no previous data, explain that the visual could not load
instead of rendering a successful result.
