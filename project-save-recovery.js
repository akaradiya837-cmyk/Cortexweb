(function attachProjectSaveRecovery(root) {
  async function loadAndApplySavedProject(projectId, loadProjects, applyProject) {
    const projects = await loadProjects();
    if (!Array.isArray(projects)) throw new Error('The backend returned an invalid project list.');
    const project = projects.find((item) => String(item.id) === String(projectId));
    if (!project) throw new Error('The saved project is no longer available in this workspace.');
    await applyProject(project, projects);
    return project;
  }

  async function handleEmptySaveConfirmation({ confirmReplacement, replaceWithEmpty, reloadSavedProject }) {
    if (confirmReplacement()) {
      return await replaceWithEmpty() ? 'replaced' : 'stale';
    }
    await reloadSavedProject();
    return 'reloaded';
  }

  root.CortexWebSaveRecovery = { handleEmptySaveConfirmation, loadAndApplySavedProject };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CortexWebSaveRecovery;
})(globalThis);
