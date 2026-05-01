export interface AgentPlugin {
	/** Unique identifier — matches the binary basename (e.g. "claude", "opencode", "aider"). */
	id: string;
	/** Default binary name looked up on PATH. */
	defaultCmd: string;
	/**
	 * Returns the default argument list for this agent.
	 * Use the literal string "{task}" as a placeholder — evalgate replaces it
	 * with the assembled prompt (context + title) at spawn time.
	 * If "{task}" is absent, evalgate appends the prompt as the last argument.
	 */
	defaultArgs: () => string[];
	/**
	 * Parse token usage from the worker's log file content and stderr.
	 * Return null if usage cannot be determined (no row written to budget.db).
	 * Must not throw — exceptions are caught by the orchestrator.
	 */
	parseUsage: (
		logContent: string,
		stderr: string,
	) => { inputTokens: number; outputTokens: number; model?: string } | null;
	/**
	 * USD per million tokens (input / output).
	 * When set, conductor computes estimatedUsd for the budget record.
	 * When absent, budget rows are written with tokens only (no USD figure).
	 */
	pricing?: { input: number; output: number };
}
