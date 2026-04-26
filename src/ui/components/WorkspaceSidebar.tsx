import { useState } from "react";
import { useDashboard } from "../context/DashboardContext.js";
import { apiInitProject } from "../hooks/api.js";

export function WorkspaceSidebar() {
	const { state, selectedProjectId, setSelectedProjectId, showToast, showError, refreshWorkspace } =
		useDashboard();
	const [initGoal, setInitGoal] = useState("");
	const [initingId, setInitingId] = useState<string | null>(null);
	const [expandedInit, setExpandedInit] = useState<string | null>(null);

	if (!state.workspace?.discovered) return null;

	const { root, projects } = state.workspace;
	const rootName = root.split("/").at(-1) ?? root;

	async function handleInit(projectId: string) {
		setInitingId(projectId);
		try {
			await apiInitProject(projectId, initGoal ? { goal: initGoal } : {});
			showToast(`Initialized ${projectId}`);
			setExpandedInit(null);
			setInitGoal("");
			await refreshWorkspace();
		} catch (e) {
			showError(e instanceof Error ? e.message : "Init failed");
		} finally {
			setInitingId(null);
		}
	}

	return (
		<aside className="workspace-sidebar">
			<div className="workspace-sidebar-header">
				<span className="workspace-root-label" title={root}>
					{rootName}
				</span>
			</div>

			<ul className="workspace-project-list" aria-label="Projects">
				{projects.map((project) => {
					const isSelected = selectedProjectId === project.id;
					const isExpanded = expandedInit === project.id;

					return (
						<li key={project.id} className="workspace-project-item">
							<button
								type="button"
								role="option"
								aria-selected={isSelected}
								className={`workspace-project-btn${isSelected ? " selected" : ""}${
									!project.initialized ? " uninit" : ""
								}`}
								onClick={() => {
									if (project.initialized) {
										setSelectedProjectId(isSelected ? null : project.id);
										setExpandedInit(null);
									} else {
										setExpandedInit(isExpanded ? null : project.id);
									}
								}}
							>
								<span
									className={`project-status-dot ${
										project.initialized
											? project.runnersActive > 0
												? "running"
												: "idle"
											: "uninit"
									}`}
								/>
								<span className="project-name">{project.id}</span>
								{project.initialized && project.runnersActive > 0 && (
									<span className="project-badge">{project.runnersActive}</span>
								)}
							</button>

							{/* Inline init form for uninitialized projects */}
							{!project.initialized && isExpanded && (
								<div className="project-init-form">
									<input
										type="text"
										placeholder="Goal (optional)"
										value={initGoal}
										onChange={(e) => setInitGoal(e.target.value)}
										className="project-init-goal"
										aria-label="Project goal"
									/>
									<div className="project-init-actions">
										<button
											type="button"
											className="btn-init"
											disabled={initingId === project.id}
											onClick={() => void handleInit(project.id)}
										>
											{initingId === project.id ? "Initializing…" : "Initialize"}
										</button>
									</div>
								</div>
							)}
						</li>
					);
				})}
			</ul>
		</aside>
	);
}
