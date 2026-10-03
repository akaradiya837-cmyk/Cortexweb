let projects = JSON.parse(localStorage.getItem('cortexweb_projects') || 'null') || [];
let connections = JSON.parse(localStorage.getItem('cortexweb_connections') || 'null') || [];
let activity = JSON.parse(localStorage.getItem('cortexweb_activity') || 'null') || [];
let submissions = [];
let backendEnabled = false;
let csrfToken = null;
let backendUser = null;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}
function safeUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate || candidate === '#') return '#';
  try {
    const url = new URL(candidate, location.href);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : '#';
  } catch {
    return '#';
  }
}
function safeMediaUrl(value) {
  const candidate = String(value || '').trim();
  if (candidate.startsWith('data:image/')) return candidate;
  return safeUrl(candidate);
}
function safeColor(value, fallback) {
  const candidate = String(value || '').trim();
  return /^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(candidate) ? candidate : fallback;
}
function safeFont(value) {
  return ['Manrope', 'Georgia', 'DM Mono', 'Verdana', 'Times New Roman'].includes(value) ? value : 'Manrope';
}
async function hashPassword(password) {
  if (!window.crypto?.subtle) return null;
  const bytes = new TextEncoder().encode(password);
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function apiRequest(path, options = {}) {
  if (!csrfToken && options.method && options.method !== 'GET') { const csrfResponse = await fetch('/api/csrf', { credentials: 'same-origin' }); if (!csrfResponse.ok) throw new Error('Backend unavailable.'); csrfToken = (await csrfResponse.json()).csrfToken; }
  const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) };
  if (csrfToken && options.method && options.method !== 'GET') headers['x-csrf-token'] = csrfToken;
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || 'Request failed.');
  return payload;
}
function backendProject(project) { const content = project.content || {}; return { ...project, ...content, status: project.status === 'Published' ? 'Live' : project.status === 'Archived' ? 'Archived' : 'In progress', updated: project.updated_at ? new Date(`${project.updated_at}Z`).toLocaleString() : 'Just now', initials: project.initials || project.client?.split(' ').map((word) => word[0]).join('').slice(0, 2).toUpperCase(), color: project.color || 'purple', publishedUrl: project.slug ? `${location.origin}/site/${encodeURIComponent(project.slug)}` : project.publishedUrl }; }
function sanitizeStorageValue(value, maxImageLength = 140000) {
  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) return value.length > maxImageLength ? '' : value;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeStorageValue(item, maxImageLength));
  if (value && typeof value === 'object') {
    const sanitized = {};
    Object.entries(value).forEach(([key, item]) => {
      if (key === 'image' || key === 'backgroundImage' || key === 'avatar') {
        sanitized[key] = typeof item === 'string' && item.startsWith('data:image/') ? (item.length > maxImageLength ? '' : item) : sanitizeStorageValue(item, maxImageLength);
        return;
      }
      sanitized[key] = sanitizeStorageValue(item, maxImageLength);
    });
    return sanitized;
  }
  return value;
}
function safeStorageSet(key, value) {
  const payload = JSON.stringify(value);
  try {
    localStorage.setItem(key, payload);
    return true;
  } catch (error) {
    const reduced = JSON.stringify(sanitizeStorageValue(value));
    try {
      localStorage.setItem(key, reduced);
      if (typeof showToast === 'function' && reduced.length < payload.length) {
        showToast('Large media was removed to stay within browser storage limits.');
      }
      return true;
    } catch {
      console.warn(`Unable to save ${key} to localStorage without exceeding quota.`);
      if (typeof showToast === 'function') {
        showToast('Browser storage is full. Remove large images or try a smaller website.');
      }
      return false;
    }
  }
}
let saveTimer = null;
function queueBackendSave() { if (!backendEnabled || !activeProject) return; clearTimeout(saveTimer); saveTimer = setTimeout(async () => { try { setSaveState('Saving...'); await apiRequest(`/api/projects/${activeProject.id}`, { method: 'PUT', body: JSON.stringify({ name: activeProject.name, client: activeProject.client, type: activeProject.type, brief: activeProject.brief, content: { builderPages: activeProject.builderPages, builderTheme: activeProject.builderTheme, siteSettings: activeProject.siteSettings } }) }); setSaveState('Saved'); } catch { setSaveState('Save failed'); } }, 450); }
function setSaveState(value) { const state = $('.save-state'); if (state) state.textContent = `● ${value}`; }
function save() { if (!backendEnabled) { safeStorageSet('cortexweb_projects', projects); safeStorageSet('cortexweb_connections', connections); safeStorageSet('cortexweb_activity', activity); } queueBackendSave(); }
async function hydrateBackend() { const result = await apiRequest('/api/projects'); projects = result.projects.map(backendProject); const [activityResult, integrationsResult, submissionsResult] = await Promise.all([apiRequest('/api/activity'), apiRequest('/api/integrations'), apiRequest('/api/submissions')]); activity = activityResult.activity.map((item) => ({ icon: '•', title: item.action, detail: item.detail, time: item.created_at })); connections = integrationsResult.integrations.map((item) => ({ ...item, project: projects.find((project) => project.id === item.project_id)?.name || 'Project', status: item.status })); submissions = submissionsResult.submissions; renderAll(); }
function showToast(message) { $('#toastMessage').textContent = message; $('#toast').classList.add('show'); setTimeout(() => $('#toast').classList.remove('show'), 2600); }
function clearFieldErrors(form) { form?.querySelectorAll('.field-error').forEach((note) => note.remove()); form?.querySelectorAll('.input-error').forEach((field) => field.classList.remove('input-error')); }
function showFieldError(field, message) { if (!field) return; field.classList.add('input-error'); const note = document.createElement('p'); note.className = 'field-error'; note.textContent = message; field.insertAdjacentElement('afterend', note); }
function validateClientForm(form) { form.noValidate = true; clearFieldErrors(form); let valid = true; form.querySelectorAll('input, select, textarea').forEach((field) => { const value = String(field.value || '').trim(); const minimum = Number(field.dataset.minlength || 0); const maximum = Number(field.dataset.maxlength || 0); let message = ''; if (field.dataset.required === 'true' && !value) message = 'This field is required.'; else if (field.dataset.validation === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) message = 'Enter a valid email address.'; else if (minimum > 0 && value.length < minimum) message = `Enter at least ${minimum} characters.`; else if (maximum > 0 && value.length > maximum) message = `Use no more than ${maximum} characters.`; if (message) { valid = false; showFieldError(field, message); } }); return valid; }
function removeNativeValidation(root = document) { if (root.matches?.('form')) root.noValidate = true; root.querySelectorAll('form').forEach((form) => { form.noValidate = true; }); root.querySelectorAll('input, select, textarea').forEach((field) => { if (field.hasAttribute('required')) field.dataset.required = 'true'; if (field.hasAttribute('minlength')) field.dataset.minlength = field.getAttribute('minlength'); if (field.hasAttribute('maxlength')) field.dataset.maxlength = field.getAttribute('maxlength'); if (field.getAttribute('type') === 'email') { field.dataset.validation = 'email'; field.setAttribute('type', 'text'); } field.removeAttribute('required'); field.removeAttribute('minlength'); field.removeAttribute('maxlength'); }); }
function showFormError(form, message) { if (!form) return; let note = form.querySelector('.form-error'); if (!note) { note = document.createElement('p'); note.className = 'form-error'; form.appendChild(note); } note.textContent = message; note.hidden = false; }
function clearFormError(form) { const note = form?.querySelector('.form-error'); if (note) { note.textContent = ''; note.hidden = true; } }
removeNativeValidation();
new MutationObserver((mutations) => mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => { if (node.nodeType === Node.ELEMENT_NODE) removeNativeValidation(node); }))).observe(document.body, { childList: true, subtree: true });
document.addEventListener('submit', (event) => { const form = event.target; if (!(form instanceof HTMLFormElement)) return; if (!validateClientForm(form)) { event.preventDefault(); event.stopImmediatePropagation(); return; } if (form.id === 'registerForm' && form.elements.password?.value !== form.elements.confirmPassword?.value) { showFieldError(form.elements.confirmPassword, 'Passwords do not match.'); event.preventDefault(); event.stopImmediatePropagation(); } }, true);
function statusClass(status) { return status === 'Live' ? 'live' : status === 'Needs review' ? 'review' : 'in-progress'; }
function renderDashboardMetrics() {
  const cards = $$('.metric-grid .metric-card');
  const metrics = [
    { label: 'Projects', value: projects.length, note: 'In this workspace' },
    { label: 'Published sites', value: projects.filter((project) => project.status === 'Live').length, note: 'Available to visitors' },
    { label: 'New leads', value: submissions.length, note: 'Captured from site forms' },
    { label: 'Draft projects', value: projects.filter((project) => project.status !== 'Live' && project.status !== 'Archived').length, note: 'Ready for the next step' }
  ];
  cards.forEach((card, index) => {
    const metric = metrics[index];
    if (!metric) return;
    card.querySelector('.metric-label').textContent = metric.label;
    card.querySelector('strong').textContent = metric.value;
    card.querySelector('.metric-note').textContent = metric.note;
  });
  const today = new Date();
  const greeting = backendUser?.name || JSON.parse(localStorage.getItem('cortexweb_user') || '{}').name || 'there';
  $('.page-heading .eyebrow').textContent = today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  $('.page-heading h1').innerHTML = `Good ${today.getHours() < 12 ? 'morning' : today.getHours() < 18 ? 'afternoon' : 'evening'}, ${escapeHtml(greeting.split(' ')[0])} <span class="wave">✦</span>`;
  const healthItems = $('.health-items');
  if (healthItems) healthItems.innerHTML = `<div><span class="health-icon">▣</span><span><strong>Workspace projects</strong><small>${projects.length} project${projects.length === 1 ? '' : 's'} saved to your account</small></span><b>${projects.length}</b></div><div><span class="health-icon">↗</span><span><strong>Published websites</strong><small>${projects.filter((project) => project.status === 'Live').length} currently public</small></span><b>${projects.filter((project) => project.status === 'Live').length}</b></div><div><span class="health-icon">✉</span><span><strong>Visitor inquiries</strong><small>${submissions.length} submission${submissions.length === 1 ? '' : 's'} received</small></span><b>${submissions.length}</b></div>`;
  $('.health-panel h2').textContent = 'Workspace snapshot';
  $('.health-panel .status-pill').textContent = backendEnabled ? '● Account synced' : '● Browser storage';
}
function renderProjects() {
  $('#projectCount').textContent = projects.length; $('#activeMetric').textContent = projects.filter((p) => p.status !== 'Live').length; $('#allProjectCount').textContent = projects.length;
  $('#projectRows').innerHTML = projects.slice(0, 3).map((p) => `<tr><td>${escapeHtml(p.name)}</td><td><span class="project-client"><span class="mini-avatar ${escapeHtml(p.color)}">${escapeHtml(p.initials)}</span>${escapeHtml(p.client)}</span></td><td><span class="status-pill ${statusClass(p.status)}">${escapeHtml(p.status)}</span></td><td>${escapeHtml(p.updated)}</td><td aria-label="Project actions">...</td></tr>`).join('');
  const query = ($('#projectSearch')?.value || '').toLowerCase();
  $('#projectCards').innerHTML = projects.filter((p) => `${p.name} ${p.client}`.toLowerCase().includes(query)).map((p) => `<article class="project-card"><div class="project-card-top"><span class="mini-avatar ${escapeHtml(p.color)}">${escapeHtml(p.initials)}</span><span class="status-pill ${statusClass(p.status)}">${escapeHtml(p.status)}</span></div><h3>${escapeHtml(p.name)}</h3><span class="client">${escapeHtml(p.client)} · ${escapeHtml(p.type)}</span><p class="card-brief">${escapeHtml(p.brief)}</p><div class="project-card-footer"><span>Updated ${escapeHtml(p.updated)}</span><button class="open-builder" data-project-id="${Number(p.id)}">Open builder →</button></div></article>`).join('');
  $$('.open-builder').forEach((button) => button.addEventListener('click', () => openBuilder(Number(button.dataset.projectId))));
}
function activityMarkup(items) { return items.map((a) => `<div class="activity-item"><span class="activity-dot">${escapeHtml(a.icon)}</span><div><strong>${escapeHtml(a.title)}</strong><p>${escapeHtml(a.detail)}</p><time>${escapeHtml(a.time)}</time></div></div>`).join(''); }
function renderActivity() { $('#activityFeed').innerHTML = activityMarkup(activity.slice(0, 4)); $('#fullActivityFeed').innerHTML = activityMarkup(activity); }
function setupLeadsView() {
  if ($('#leadsView')) return;
  const projectsLink = $('.nav-item[data-view="projects"]');
  projectsLink.insertAdjacentHTML('afterend', '<button class="nav-item" data-view="leads"><span class="nav-icon">✉</span>Leads</button>');
  const leadsLink = $('.nav-item[data-view="leads"]');
  leadsLink.addEventListener('click', () => { navigate('leads'); loadLeads(); });
  $('.main-content').insertAdjacentHTML('beforeend', '<section class="page-view leads-view" id="leadsView"><div class="page-heading"><div><p class="eyebrow">Workspace / Leads</p><h1>Leads inbox</h1><p class="heading-copy">Messages submitted through forms on your published websites.</p></div><div class="leads-actions"><button class="outline-button" id="leadsBack">← Builder</button><button class="outline-button" id="refreshLeads">↻ Refresh</button></div></div><div class="leads-toolbar"><span class="leads-count" id="leadsCount">0 submissions</span><label class="search-field">⌕ <input id="leadsSearch" type="search" placeholder="Search name, email, or project" /></label></div><div class="panel leads-panel"><div class="leads-table-wrap"><table id="leadsTable"><thead><tr><th>Contact</th><th>Website</th><th>Type</th><th>Message</th><th>Received</th></tr></thead><tbody id="leadsRows"></tbody></table></div><div class="empty-state leads-empty" id="leadsEmpty"><span>✉</span><h2>No submissions yet</h2><p>Publish a website with a contact form to collect visitor inquiries here.</p></div><p class="leads-error" id="leadsError" hidden></p></div></section>');
  $('#leadsBack').addEventListener('click', () => navigate('builder'));
  $('#refreshLeads').addEventListener('click', loadLeads);
  $('#leadsSearch').addEventListener('input', renderLeads);
}
function renderLeads() {
  if (!$('#leadsView')) return;
  const query = ($('#leadsSearch').value || '').trim().toLowerCase();
  const matches = submissions.filter((lead) => `${lead.name} ${lead.email} ${lead.project_name} ${lead.message} ${lead.form_type}`.toLowerCase().includes(query));
  $('#leadsCount').textContent = `${submissions.length} submission${submissions.length === 1 ? '' : 's'}`;
  $('#leadsRows').innerHTML = matches.map((lead) => {
    const received = new Date(`${lead.created_at.replace(' ', 'T')}Z`).toLocaleString();
    return `<tr><td><strong>${escapeHtml(lead.name)}</strong><a href="mailto:${escapeHtml(lead.email)}">${escapeHtml(lead.email)}</a></td><td>${escapeHtml(lead.project_name)}</td><td>${escapeHtml(lead.form_type)}</td><td class="lead-message">${escapeHtml(lead.message)}</td><td>${escapeHtml(received)}</td></tr>`;
  }).join('');
  const noResults = matches.length === 0;
  $('#leadsTable').hidden = noResults;
  $('#leadsEmpty').hidden = !noResults;
  $('#leadsEmpty h2').textContent = submissions.length && query ? 'No matching submissions' : 'No submissions yet';
  $('#leadsEmpty p').textContent = !backendEnabled ? 'Run CortexWeb through its Node server to store and manage visitor submissions.' : submissions.length && query ? 'Try a different name, email, website, or message.' : 'Publish a website with a contact form to collect visitor inquiries here.';
}
async function loadLeads() {
  if (!backendEnabled) { renderLeads(); return; }
  const button = $('#refreshLeads');
  const error = $('#leadsError');
  button.disabled = true;
  button.textContent = 'Loading...';
  error.hidden = true;
  try { const result = await apiRequest('/api/submissions'); submissions = result.submissions; renderLeads(); renderDashboardMetrics(); }
  catch (requestError) { error.textContent = requestError.message; error.hidden = false; }
  finally { button.disabled = false; button.textContent = '↻ Refresh'; }
}
function renderConnections() {
  $('#connectionMetric').textContent = connections.length; $('#connectionSummary').textContent = `${connections.length} connections across ${new Set(connections.map((c) => c.project)).size} projects.`;
  const query = ($('#connectionSearch')?.value || '').toLowerCase();
  $('#connectionList').innerHTML = connections.filter((c) => `${c.name} ${c.project} ${c.type}`.toLowerCase().includes(query)).map((c) => `<div class="connection-row"><div class="connection-name"><span class="db-icon">⌘</span><span><strong>${escapeHtml(c.name)}</strong><small>${escapeHtml(c.project)}</small></span></div><span>${escapeHtml(c.type)}</span><span class="env">● ${escapeHtml(c.environment)}</span><span>Updated today</span><button class="icon-button more" title="More options" aria-label="Connection actions">...</button></div>`).join('');
}
function renderAll() { renderProjects(); renderActivity(); renderConnections(); renderDashboardMetrics(); renderLeads(); }
function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }
function navigate(view) { if (document.body.classList.contains('user-mode') && !['builder', 'profile', 'leads'].includes(view)) return; $$('.page-view').forEach((section) => section.classList.remove('active-view')); $(`#${view}View`).classList.add('active-view'); $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view)); $('#breadcrumbCurrent').textContent = view.charAt(0).toUpperCase() + view.slice(1); $('#sidebar').classList.remove('open'); }
$$('.nav-item, [data-view="projects"]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view || 'projects')));
$('#menuToggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#topNewProject').addEventListener('click', () => openModal('#projectModal')); $('#newProjectButton').addEventListener('click', () => openModal('#projectModal')); $('#newConnectionButton').addEventListener('click', () => { $('#connectionProject').innerHTML = projects.map((p) => `<option value="${Number(p.id)}">${escapeHtml(p.name)}</option>`).join(''); openModal('#connectionModal'); });
$$('[data-close]').forEach((button) => button.addEventListener('click', () => closeModal(`#${button.dataset.close}`)));
$$('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => { if (event.target === backdrop) backdrop.classList.remove('open'); }));
$('#projectForm').addEventListener('submit', async (event) => { event.preventDefault(); clearFormError(event.target); const data = Object.fromEntries(new FormData(event.target)); try { if (backendEnabled) { const result = await apiRequest('/api/projects', { method: 'POST', body: JSON.stringify(data) }); projects.unshift(backendProject(result.project)); await hydrateBackend(); } else { const initials = data.client.split(' ').map((word) => word[0]).join('').slice(0, 2).toUpperCase(); projects.unshift({ id: Date.now(), name: data.name, client: data.client, type: data.type, status: 'In progress', initials, color: 'purple', updated: 'Just now', brief: data.brief }); activity.unshift({ icon: '▣', title: 'New project created', detail: `${data.name} · by Anand`, time: 'Just now' }); save(); renderAll(); } closeModal('#projectModal'); event.target.reset(); navigate('projects'); showToast('Project created successfully.'); } catch (error) { showFormError(event.target, error.message); } });
$('#connectionForm').addEventListener('submit', async (event) => { event.preventDefault(); clearFormError(event.target); const data = Object.fromEntries(new FormData(event.target)); try { if (backendEnabled) { await apiRequest('/api/integrations', { method: 'POST', body: JSON.stringify({ ...data, projectId: Number(data.project) }) }); await hydrateBackend(); } else { const project = projects.find((item) => item.id === Number(data.project)); connections.unshift({ id: Date.now(), name: data.name, project: project?.name || 'Project', type: data.type, environment: data.environment, status: 'Demo integration' }); activity.unshift({ icon: '⌘', title: 'Demo integration added', detail: `${data.name} · ${data.type}`, time: 'Just now' }); save(); renderAll(); } closeModal('#connectionModal'); event.target.reset(); navigate('connections'); showToast('Integration record added.'); } catch (error) { showFormError(event.target, error.message); } });
$('#projectSearch').addEventListener('input', renderProjects); $('#connectionSearch').addEventListener('input', renderConnections); $('#clientToast').addEventListener('click', () => showToast('Client directory is ready for the next step.'));
setupLeadsView();
renderAll();
document.querySelector('.quote-panel small').textContent = 'CortexWeb field notes · 04';

const blockDefinitions = [
  { type: 'nav', icon: '≡', label: 'Navbar', order: 10, heading: 'Your brand, made clear.', description: 'A simple, focused way to help visitors find their way.', button: 'Explore' },
  { type: 'hero', icon: '✦', label: 'Hero section', order: 20, heading: 'Make a memorable first impression.', description: 'Tell people what you do and why it matters in one clear sentence.', button: 'Get started' },
  { type: 'text', icon: 'T', label: 'Text section', order: 30, heading: 'Share your story.', description: 'Explain what makes your business different with clear, flexible content.', button: '' },
  { type: 'image', icon: '▧', label: 'Image & video', order: 40, heading: 'Show, don’t just tell.', description: 'Add a visual moment that makes your page feel unmistakably yours.', button: 'View gallery' },
  { type: 'feature', icon: '▦', label: 'Feature cards', order: 50, heading: 'Everything your audience needs.', description: 'Showcase the important details with a flexible set of feature cards.', button: 'Learn more' },
  { type: 'button', icon: '↗', label: 'Call-to-action', order: 60, heading: 'Ready when you are.', description: 'Guide visitors toward the next step with a clear action.', button: 'Get started' },
  { type: 'pricing', icon: '₹', label: 'Pricing table', order: 70, heading: 'Simple plans that scale.', description: 'Make it easy for people to understand your offer and choose a plan.', button: 'Choose plan' },
  { type: 'testimonial', icon: '“', label: 'Testimonials', order: 80, heading: 'Loved by people like you.', description: '“CortexWeb helped us launch with confidence.” — A happy customer', button: '' },
  { type: 'faq', icon: '?', label: 'FAQ section', order: 90, heading: 'Frequently asked questions.', description: 'Answer the questions your visitors are already thinking about.', button: 'See all answers' },
  { type: 'form', icon: '▤', label: 'Contact form', order: 100, heading: 'Let’s make something useful.', description: 'Give visitors a simple way to reach you.', button: 'Send message' },
  { type: 'register', icon: '□', label: 'Register form', order: 110, heading: 'Create your account.', description: 'A clear signup experience for members, customers, or communities.', button: 'Create account' },
  { type: 'login', icon: '→', label: 'Login form', order: 120, heading: 'Welcome back.', description: 'Let returning users securely access their account.', button: 'Log in' },
  { type: 'gallery', icon: '▤', label: 'Gallery grid', order: 130, heading: 'A closer look.', description: 'Arrange images, work, or products in a responsive visual grid.', button: 'View more' },
  { type: 'product', icon: '◇', label: 'Product grid', order: 140, heading: 'Featured products.', description: 'Help visitors compare your products with clear descriptions, ratings, and prices.', button: 'Shop now' },
  { type: 'footer', icon: '⌄', label: 'Footer', order: 999, heading: 'Built with intention.', description: '© 2026 Your brand. All rights reserved.', button: '' }
];
const themeDefinitions = [
  { id: 'studio', name: 'Studio editorial', note: 'Portfolio & agency · 4 pages', swatch: '#172320', pages: [['Home', ['nav', 'hero', 'feature', 'testimonial', 'footer']], ['About', ['nav', 'text', 'image', 'footer']], ['Services', ['nav', 'feature', 'pricing', 'faq', 'footer']], ['Contact', ['nav', 'form', 'footer']]] },
  { id: 'commerce', name: 'Commerce bright', note: 'Store & products · 4 pages', swatch: '#d8f36b', pages: [['Home', ['nav', 'hero', 'feature', 'footer']], ['Shop', ['nav', 'gallery', 'pricing', 'footer']], ['Product', ['nav', 'image', 'text', 'button', 'footer']], ['Account', ['nav', 'login', 'register', 'footer']]] },
  { id: 'saas', name: 'SaaS launch', note: 'Product & startup · 3 pages', swatch: '#dfeaff', pages: [['Home', ['nav', 'hero', 'feature', 'testimonial', 'footer']], ['Pricing', ['nav', 'pricing', 'faq', 'button', 'footer']], ['Login', ['nav', 'login', 'register', 'footer']]] },
  { id: 'community', name: 'Community warm', note: 'Membership & events · 4 pages', swatch: '#ffdcd3', pages: [['Home', ['nav', 'hero', 'text', 'footer']], ['Events', ['nav', 'gallery', 'feature', 'footer']], ['Members', ['nav', 'register', 'login', 'testimonial', 'footer']], ['Contact', ['nav', 'form', 'faq', 'footer']]] },
  { id: 'restaurant', name: 'Restaurant & cafe', note: 'Food, menus & bookings · 3 pages', swatch: '#f6d6a8', pages: [['Home', ['nav', 'hero', 'feature', 'button', 'footer']], ['Menu', ['nav', 'gallery', 'pricing', 'footer']], ['Contact', ['nav', 'form', 'faq', 'footer']]] },
  { id: 'creator', name: 'Creator portfolio', note: 'Personal brand & work · 3 pages', swatch: '#d9e7ff', pages: [['Home', ['nav', 'hero', 'gallery', 'footer']], ['Work', ['nav', 'image', 'feature', 'footer']], ['Contact', ['nav', 'testimonial', 'form', 'footer']]] },
  { id: 'course', name: 'Course launch', note: 'Education & cohorts · 4 pages', swatch: '#e5dcff', pages: [['Home', ['nav', 'hero', 'feature', 'testimonial', 'footer']], ['Curriculum', ['nav', 'text', 'faq', 'button', 'footer']], ['Pricing', ['nav', 'pricing', 'faq', 'footer']], ['Enroll', ['nav', 'register', 'form', 'footer']]] },
  { id: 'real-estate', name: 'Real estate', note: 'Property listings & agents · 4 pages', swatch: '#dcefe8', pages: [['Home', ['nav', 'hero', 'feature', 'button', 'footer']], ['Properties', ['nav', 'gallery', 'pricing', 'form', 'footer']], ['About', ['nav', 'text', 'testimonial', 'footer']], ['Contact', ['nav', 'form', 'faq', 'footer']]] },
  { id: 'fitness', name: 'Fitness studio', note: 'Classes, coaching & wellness · 3 pages', swatch: '#ffe0c7', pages: [['Home', ['nav', 'hero', 'feature', 'testimonial', 'footer']], ['Classes', ['nav', 'pricing', 'faq', 'footer']], ['Join us', ['nav', 'register', 'form', 'footer']]] },
  { id: 'events', name: 'Events & conference', note: 'Conferences, launches & tickets · 4 pages', swatch: '#dce2ff', pages: [['Home', ['nav', 'hero', 'button', 'footer']], ['Schedule', ['nav', 'feature', 'faq', 'footer']], ['Speakers', ['nav', 'gallery', 'testimonial', 'footer']], ['Register', ['nav', 'register', 'form', 'footer']]] }
];
const savedTemplates = JSON.parse(localStorage.getItem('cortexweb_custom_templates') || '[]');
themeDefinitions.push(...savedTemplates.filter((template) => template.id && template.name && Array.isArray(template.pages)));
const themeProfiles = {
  studio: { title: 'Atelier Studio', description: 'Independent design and digital direction for brands with something to say.', accent: '#d8f36b', hero: 'Design with a point of view.', heroDescription: 'A thoughtful creative partner for identities, websites, and digital experiences.' },
  commerce: { title: 'Good Things Market', description: 'Small-batch objects, considered materials, and everyday pieces worth keeping.', accent: '#d8f36b', hero: 'Objects for a life well lived.', heroDescription: 'Discover useful, beautiful goods made slowly and chosen carefully.' },
  saas: { title: 'Northstar', description: 'A calmer command center for teams building what comes next.', accent: '#a9c4ff', hero: 'Move your best work forward.', heroDescription: 'Plan clearly, collaborate quickly, and turn ambitious ideas into momentum.' },
  community: { title: 'Common Ground', description: 'A warm place for curious people to meet, learn, and make things together.', accent: '#ffad96', hero: 'There is room for everyone here.', heroDescription: 'Find your people, join the conversation, and make your next connection count.' },
  restaurant: { title: 'Juniper Table', description: 'Seasonal plates, open-fire cooking, and a table waiting for you.', accent: '#e6a355', hero: 'Come hungry. Leave happy.', heroDescription: 'A neighborhood kitchen serving generous food and good reasons to linger.' },
  creator: { title: 'Mira Rao', description: 'Writer, image-maker, and creative partner for meaningful ideas.', accent: '#8db5e8', hero: 'Stories that stay with you.', heroDescription: 'Selected work, honest notes, and a closer look at the process behind the work.' },
  course: { title: 'The Practice Room', description: 'Practical learning for people ready to make their next move.', accent: '#ad91e8', hero: 'Learn it. Use it. Make it yours.', heroDescription: 'A focused curriculum and a generous community to help you build with confidence.' },
  'real-estate': { title: 'Field & Form', description: 'Homes with character, guided by people who know the neighborhood.', accent: '#7cba9f', hero: 'Find a place to become.', heroDescription: 'Thoughtfully represented homes and a more personal way to move.' },
  fitness: { title: 'Form House', description: 'Strength, mobility, and steady progress in a studio built around you.', accent: '#ed9a67', hero: 'Feel stronger in your own body.', heroDescription: 'Small-group training and expert coaching for sustainable energy every day.' },
  events: { title: 'Signal / 26', description: 'Ideas, people, and the conversations shaping the next chapter.', accent: '#91a5ed', hero: 'The future is a conversation.', heroDescription: 'One focused day of talks, workshops, and useful collisions of perspective.' }
};
const completePageSets = {
  studio: [['Home', ['nav', 'hero', 'feature', 'footer']], ['Work', ['nav', 'gallery', 'image', 'footer']], ['Services', ['nav', 'feature', 'pricing', 'footer']], ['Journal', ['nav', 'text', 'testimonial', 'footer']], ['Contact', ['nav', 'form', 'faq', 'footer']]],
  commerce: [['Home', ['nav', 'hero', 'feature', 'footer']], ['Shop', ['nav', 'product', 'footer']], ['Collections', ['nav', 'image', 'feature', 'footer']], ['About', ['nav', 'text', 'testimonial', 'footer']], ['Contact', ['nav', 'form', 'faq', 'footer']]],
  saas: [['Home', ['nav', 'hero', 'feature', 'footer']], ['Product', ['nav', 'feature', 'image', 'footer']], ['Solutions', ['nav', 'feature', 'testimonial', 'footer']], ['Resources', ['nav', 'text', 'faq', 'footer']], ['Sign in', ['nav', 'login', 'register', 'footer']]],
  community: [['Home', ['nav', 'hero', 'text', 'footer']], ['Events', ['nav', 'gallery', 'feature', 'footer']], ['Members', ['nav', 'register', 'testimonial', 'footer']], ['Resources', ['nav', 'text', 'faq', 'footer']], ['Contact', ['nav', 'form', 'footer']]],
  restaurant: [['Home', ['nav', 'hero', 'feature', 'footer']], ['Menu', ['nav', 'gallery', 'pricing', 'footer']], ['Specials', ['nav', 'image', 'feature', 'footer']], ['Our story', ['nav', 'text', 'testimonial', 'footer']], ['Contact', ['nav', 'form', 'faq', 'footer']]],
  creator: [['Home', ['nav', 'hero', 'gallery', 'footer']], ['Portfolio', ['nav', 'gallery', 'image', 'footer']], ['About', ['nav', 'text', 'testimonial', 'footer']], ['Process', ['nav', 'feature', 'faq', 'footer']], ['Contact', ['nav', 'form', 'footer']]],
  course: [['Home', ['nav', 'hero', 'feature', 'footer']], ['Curriculum', ['nav', 'text', 'faq', 'footer']], ['Resources', ['nav', 'gallery', 'feature', 'footer']], ['Pricing', ['nav', 'pricing', 'testimonial', 'footer']], ['Enroll', ['nav', 'register', 'form', 'footer']]],
  'real-estate': [['Home', ['nav', 'hero', 'feature', 'footer']], ['Properties', ['nav', 'gallery', 'pricing', 'footer']], ['Neighborhoods', ['nav', 'image', 'text', 'footer']], ['Buying guide', ['nav', 'text', 'faq', 'footer']], ['Contact', ['nav', 'form', 'footer']]],
  fitness: [['Home', ['nav', 'hero', 'feature', 'footer']], ['Classes', ['nav', 'pricing', 'faq', 'footer']], ['Training', ['nav', 'image', 'feature', 'footer']], ['About', ['nav', 'text', 'testimonial', 'footer']], ['Join us', ['nav', 'register', 'form', 'footer']]],
  events: [['Home', ['nav', 'hero', 'button', 'footer']], ['Schedule', ['nav', 'feature', 'faq', 'footer']], ['Speakers', ['nav', 'gallery', 'testimonial', 'footer']], ['Resources', ['nav', 'text', 'image', 'footer']], ['Register', ['nav', 'register', 'form', 'footer']]]
};
Object.entries(completePageSets).forEach(([id, pages]) => { const theme = themeDefinitions.find((item) => item.id === id); if (theme) { theme.pages = pages; theme.note = theme.note.replace(/\d+ pages/, '5 pages'); } });
let activeProject = null;
let selectedSection = null;
let activePageIndex = 0;
function openBuilder(projectId) {
  activeProject = projects.find((project) => project.id === projectId) || projects[0];
  if (!activeProject) { showToast('Create a project before opening the builder.'); return; }
  addProfilePage();
  addExportControls();
  addSiteSettings();
  addInspectorStyleControls();
  $('#builderTitle').textContent = activeProject.name;
  $('#builderProjectLabel').textContent = activeProject.name;
  $('#builderTypeLabel').textContent = activeProject.type;
  function addSiteSettings() {
    if ($('#siteSettings')) return;
    $('.builder-heading').insertAdjacentHTML('afterend', '<form id="siteSettings" class="site-settings"><strong>Site settings</strong><label>Site title<input id="siteTitle" maxlength="60" /></label><label>Site description<input id="siteDescription" maxlength="140" /></label><label>Brand color<input id="siteAccent" type="color" value="#d8f36b" /></label><button class="outline-button" type="submit">Save site settings</button></form>');
    $('#siteSettings').addEventListener('submit', (event) => { event.preventDefault(); activeProject.siteSettings = { title: $('#siteTitle').value.trim() || activeProject.name, description: $('#siteDescription').value.trim(), accent: $('#siteAccent').value }; save(); renderHostedPage(activePageIndex); showToast('Site settings saved.'); });
  }
  function renderSiteSettings() {
    const settings = activeProject?.siteSettings || {};
    if (!$('#siteSettings')) return;
    $('#siteTitle').value = settings.title || activeProject.name;
    $('#siteDescription').value = settings.description || activeProject.brief || '';
    $('#siteAccent').value = settings.accent || '#d8f36b';
  }
  $('#canvasSlug').textContent = activeProject.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'your-site';
  if (!$('#toggleLibrary')) { $('.builder-actions').insertAdjacentHTML('afterbegin', '<button class="outline-button" id="toggleLibrary">☷ Sections</button>'); $('#toggleLibrary').addEventListener('click', () => { $('.builder-layout').classList.toggle('library-collapsed'); $('#toggleLibrary').textContent = $('.builder-layout').classList.contains('library-collapsed') ? '☷ Show sections' : '☷ Sections'; }); }
  const saveState = $('.builder-actions .save-state'); if (saveState) $('.builder-actions').insertBefore(saveState, $('.builder-actions').firstElementChild);
  if (!$('#publishedLinkBar')) { $('.builder-heading').insertAdjacentHTML('afterend', '<div class="published-link-bar" id="publishedLinkBar"><span>● Published URL</span><a id="editorPublishedUrl" target="_blank" rel="noopener"></a><button class="outline-button" id="editorCopyLink">Copy link</button></div>'); $('#editorCopyLink').addEventListener('click', () => copyPublishedLink()); }
  if (activeProject.publishedUrl) { $('#publishedLinkBar').classList.add('visible'); $('#editorPublishedUrl').textContent = activeProject.publishedUrl; $('#editorPublishedUrl').href = activeProject.publishedUrl; }
  navigate('builder');
  renderBuilderBlocks();
    renderSiteSettings();
  renderPageTabs();
  renderCanvas();
}
function setupTemplateModal() {
  if ($('#templateModal')) return;
  $('.main-content').insertAdjacentHTML('beforeend', '<div class="template-modal" id="templateModal"><div class="template-window"><div class="template-window-head"><div><p class="eyebrow">CortexWeb library</p><h2>Inbuilt templates</h2><p>Choose a complete website, then edit every page and section.</p></div><button class="modal-close" id="closeTemplates">×</button></div><div class="template-tools" id="templateTools"><input id="templateSearch" placeholder="Search templates" /><div><input id="templateApiUrl" placeholder="Template API URL" /><button class="outline-button" id="addApiTemplate" type="button">＋ Add from API</button></div><small>Use a JSON template URL or upload a template file.</small></div><div class="template-gallery" id="templateGallery"></div></div></div>');
  $('#closeTemplates').addEventListener('click', () => $('#templateModal').classList.remove('open'));
  $('#templateSearch').addEventListener('input', renderBuilderBlocks);
}
function renderBuilderBlocks() {
  setupTemplateModal();
  if ($('#themeLibrary')) { $('#themeLibrary').style.display = 'none'; $('#themeLibrary').previousElementSibling.style.display = 'none'; }
  $('#addApiTemplate').onclick = addTemplateFromApi;
  const query = ($('#templateSearch').value || '').toLowerCase();
  $('#templateGallery').innerHTML = themeDefinitions.filter((theme) => `${theme.name} ${theme.note}`.toLowerCase().includes(query)).map((theme) => `<button class="theme-card ${activeProject.builderTheme === theme.id ? 'selected' : ''}" data-theme-id="${theme.id}"><span class="template-preview" style="--template-color:${theme.swatch}"><i></i><i></i><i></i><strong>${(themeProfiles[theme.id]?.title || theme.name).split(' ')[0]}</strong></span><span><strong>${theme.name}</strong><small>${themeProfiles[theme.id]?.description || theme.note}</small></span><b>Use</b></button>`).join('') || '<p class="template-empty">No templates found.</p>';
  $$('#templateGallery .theme-card').forEach((card) => card.addEventListener('click', () => { applyTheme(card.dataset.themeId); $('#templateModal').classList.remove('open'); }));
  $('#blockLibrary').innerHTML = blockDefinitions.map((block) => `<div class="library-block" draggable="true" data-block-type="${block.type}"><span class="block-icon">${block.icon}</span>${block.label}<span class="drag-grip">⠿</span></div>`).join('');
  $$('.library-block').forEach((block) => {
    block.addEventListener('dragstart', (event) => event.dataTransfer.setData('text/plain', block.dataset.blockType));
    block.addEventListener('click', () => addSection(block.dataset.blockType));
  });
}
function addTemplateFromApi() {
  const url = $('#templateApiUrl').value.trim();
  if (!url) { showToast('Paste a template API URL first.'); return; }
  fetch(url).then((response) => { if (!response.ok) throw new Error('Request failed'); return response.json(); }).then((data) => {
    const incoming = Array.isArray(data) ? data : data.templates || [data];
    const valid = incoming.filter((template) => template.name && Array.isArray(template.pages) && template.pages.every((page) => Array.isArray(page) && page.length === 2 && Array.isArray(page[1]) && page[1].every((type) => blockDefinitions.some((block) => block.type === type)))).map((template, index) => ({ id: `api-${Date.now()}-${index}`, name: template.name, note: template.note || 'Custom template · API', swatch: template.swatch || '#dfeaff', pages: template.pages }));
    if (!valid.length) throw new Error('Invalid template format');
    themeDefinitions.push(...valid); localStorage.setItem('cortexweb_custom_templates', JSON.stringify([...savedTemplates, ...valid])); renderBuilderBlocks(); showToast(`${valid.length} template${valid.length === 1 ? '' : 's'} added.`);
  }).catch(() => showToast('Could not load templates. Check the URL and CORS settings.'));
}
function applyTheme(themeId) {
  const theme = themeDefinitions.find((item) => item.id === themeId);
  if (!theme || !activeProject) return;
  const profile = themeProfiles[themeId] || { title: theme.name, description: theme.note, accent: theme.swatch, hero: 'Make something people remember.', heroDescription: 'A flexible starting point for your next website.' };
  const byType = (type) => blockDefinitions.find((block) => block.type === type);
  activeProject.builderTheme = themeId;
  activeProject.siteSettings = { title: profile.title, description: profile.description, accent: profile.accent };
  activeProject.builderPages = theme.pages.map(([name, types]) => ({ name, sections: types.map((type) => { const definition = byType(type); const isHero = type === 'hero'; return { type, order: definition.order, content: { heading: isHero ? profile.hero : definition.heading, description: isHero ? profile.heroDescription : definition.description, button: definition.button, navLinks: type === 'nav' ? ['Home', 'Products', 'Services', 'About', 'Contact'] : undefined, background: isHero ? `${profile.accent}33` : '#ffffff', textColor: '#172320', buttonColor: '#172320' } }; }) }));
  activeProject.builderSections = activeProject.builderPages[0].sections; activePageIndex = 0; selectedSection = null; $('#inspectorForm').classList.remove('visible'); $('#inspectorEmpty').style.display = 'block'; renderPageTabs(); renderCanvas(); showToast(`${theme.name} template applied with ${theme.pages.length} pages.`);
}
function ensurePages() { if (!activeProject.builderPages) activeProject.builderPages = [{ name: 'Home', sections: activeProject.builderSections || [] }]; activeProject.builderSections = activeProject.builderPages[activePageIndex].sections; }
function renderPageTabs() { ensurePages(); let tabs = $('#pageTabs'); if (!tabs) { $('.canvas-toolbar').insertAdjacentHTML('beforebegin', '<div id="pageTabs" class="page-tabs"></div>'); tabs = $('#pageTabs'); } tabs.innerHTML = `${activeProject.builderPages.map((page, index) => `<button class="page-tab ${index === activePageIndex ? 'active' : ''}" data-page-index="${index}" title="Double-click to rename">${page.name} <span class="rename-hint">✎</span></button>`).join('')}<button class="page-tab add-page" id="addPage">＋ Add page</button>`; $$('.page-tab[data-page-index]').forEach((tab) => { tab.addEventListener('click', () => { activePageIndex = Number(tab.dataset.pageIndex); ensurePages(); selectedSection = null; renderPageTabs(); renderCanvas(); }); tab.addEventListener('dblclick', (event) => { event.preventDefault(); renamePage(Number(tab.dataset.pageIndex)); }); }); $('#addPage').addEventListener('click', () => { const pageName = `Page ${activeProject.builderPages.length + 1}`; activeProject.builderPages.push({ name: pageName, sections: [] }); activePageIndex = activeProject.builderPages.length - 1; ensurePages(); renderPageTabs(); renderCanvas(); showToast(`${pageName} added.`); }); }
function renamePage(index) { const currentName = activeProject.builderPages[index].name; const nextName = window.prompt('Enter a name for this page', currentName); if (!nextName || !nextName.trim()) return; activeProject.builderPages[index].name = nextName.trim().slice(0, 32); save(); renderPageTabs(); showToast('Page name updated.'); }
function addTimesNewRomanOption() {
  const fontSelect = $('#editFontFamily');
  if (fontSelect && !fontSelect.querySelector('option[value="Times New Roman"]')) fontSelect.insertAdjacentHTML('beforeend', '<option value="Times New Roman">Times New Roman</option>');
}
function addJustifyOption() {
  const alignSelect = $('#editTextAlign');
  if (alignSelect && !alignSelect.querySelector('option[value="justify"]')) alignSelect.insertAdjacentHTML('beforeend', '<option value="justify">Justify</option>');
}
function moveApplyButtonToEnd() {
  const form = $('#inspectorForm');
  const applyButton = form?.querySelector('button[type="submit"]');
  if (form && applyButton) form.appendChild(applyButton);
}
function sectionMarkup(section, index) {
  const definition = blockDefinitions.find((block) => block.type === section.type) || blockDefinitions[1];
  const content = section.content || definition;
  const textAlignments = ['left', 'center', 'right', 'justify'];
  const imageAlignments = ['left', 'center', 'right'];
  const textAlign = textAlignments.includes(content.textAlign) ? content.textAlign : 'left';
  const imageAlign = imageAlignments.includes(content.imageAlign) ? content.imageAlign : 'left';
  const imageWidth = Math.min(100, Math.max(25, Number(content.imageWidth) || 100));
  const imageStyle = `max-width:${imageWidth}%;margin-left:${imageAlign === 'center' ? 'auto' : '0'};margin-right:${imageAlign === 'right' ? '0' : imageAlign === 'center' ? 'auto' : 'auto'};`;
  const backgroundImage = safeMediaUrl(content.backgroundImage);
  const imageUrl = safeMediaUrl(content.image);
  const style = `background-color:${safeColor(content.background, '#ffffff')};color:${safeColor(content.textColor, '#172320')};font-family:${safeFont(content.fontFamily)},sans-serif;font-size:${Math.min(40, Math.max(10, Number(content.fontSize) || 14))}px;text-align:${textAlign};${backgroundImage !== '#' ? `background-image:linear-gradient(90deg,rgba(255,255,255,.9),rgba(255,255,255,.55)),url(${backgroundImage});background-size:cover;background-position:center;` : ''}`;
  const navLinks = section.type === 'nav' ? `<nav class="section-nav-links">${(content.navLinks || ['Home', 'Products', 'Services', 'About', 'Contact']).map((link) => `<a href="#${escapeHtml(String(link).toLowerCase().replace(/[^a-z0-9]+/g, '-'))}" data-nav-link>${escapeHtml(link)}</a>`).join('')}</nav>` : '';
  const button = content.button ? `<a class="canvas-button" style="background-color:${safeColor(content.buttonColor, '#172320')}" href="${escapeHtml(safeUrl(content.link))}" ${content.link ? 'target="_blank" rel="noopener"' : ''}>${escapeHtml(content.button)} →</a>` : '';
  const features = section.type === 'feature' ? '<div class="section-feature"><div class="feature-box"><strong>Simple setup</strong><p>Everything in one place.</p></div><div class="feature-box"><strong>Made for you</strong><p>Flexible and easy to edit.</p></div><div class="feature-box"><strong>Ready to grow</strong><p>Built for what is next.</p></div></div>' : '';
  const formTypes = ['form', 'register', 'login'];
  const form = formTypes.includes(section.type) ? `<form class="ready-form" data-form-type="${section.type}">${section.type !== 'login' ? '<input data-required="true" data-minlength="2" data-maxlength="80" name="name" placeholder="Your name" />' : ''}<input data-required="true" data-validation="email" data-maxlength="160" name="email" type="text" placeholder="Email address" /><textarea data-required="true" data-minlength="5" data-maxlength="2000" name="message" placeholder="${section.type === 'form' ? 'How can we help?' : 'Tell us what you need'}"></textarea><button class="canvas-button" type="submit">${escapeHtml(content.button || 'Submit')} →</button></form>` : '';
  const image = imageUrl !== '#' ? `<img class="uploaded-section-image" style="${imageStyle}" src="${escapeHtml(imageUrl)}" alt="Section visual" />` : '';
  const pricing = section.type === 'pricing' ? '<div class="price-cards"><div><small>Starter</small><strong>₹999</strong><span>per month</span></div><div><small>Growth</small><strong>₹2,499</strong><span>per month</span></div></div>' : '';
  const productItems = section.type === 'product' ? (content.products || defaultProducts()).map((product, productIndex) => `<div class="product-card"><div class="product-card-image"><span>${productIndex + 1}</span></div><div class="product-card-body"><div class="product-rating" aria-label="${escapeHtml(product.rating)} out of 5 stars">★★★★★ <b>${escapeHtml(product.rating)}</b></div><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description)}</p><strong class="product-price">${escapeHtml(product.price)}</strong></div></div>`).join('') : '';
  const products = section.type === 'product' ? `<div class="product-grid">${productItems}</div>${document.body.classList.contains('user-mode') ? '<button class="add-product" type="button">＋ Add product</button>' : ''}` : '';
  const faq = section.type === 'faq' ? '<div class="faq-lines"><span>What does this include? <b>＋</b></span><span>Can I change my plan? <b>＋</b></span></div>' : '';
  const imageClass = ['image', 'gallery'].includes(section.type) && !content.image ? ' without-image' : '';
  return `<article class="canvas-section section-${escapeHtml(section.type)}${imageClass} ${selectedSection === index ? 'selected' : ''}" draggable="true" style="${style}" data-section-index="${index}"><div class="section-controls"><button class="move-section" type="button" data-move="top" title="Move to top">⇈</button><button class="move-section" type="button" data-move="up" title="Move up">↑</button><button class="move-section" type="button" data-move="down" title="Move down">↓</button><button class="move-section" type="button" data-move="bottom" title="Move to bottom">⇊</button><button class="remove-section" type="button" title="Remove section" aria-label="Remove ${escapeHtml(definition.label)}">×</button></div>${image}<h2>${escapeHtml(content.heading)}</h2><p>${escapeHtml(content.description)}</p>${navLinks}${features}${pricing}${products}${faq}${form}${!formTypes.includes(section.type) && !['feature', 'pricing', 'faq', 'image', 'gallery', 'nav', 'product'].includes(section.type) ? button : ''}</article>`;
}
function addInspectorStyleControls() {
  if ($('#sectionStyleControls')) return;
  $('#inspectorForm').insertAdjacentHTML('beforeend', '<fieldset class="section-style-controls" id="sectionStyleControls"><legend>Text &amp; image style</legend><label>Font<select id="editFontFamily"><option value="Manrope">Manrope</option><option value="Georgia">Georgia</option><option value="DM Mono">DM Mono</option><option value="Verdana">Verdana</option></select></label><label>Font size <output id="editFontSizeValue">14px</output><input id="editFontSize" type="range" min="10" max="40" value="14" /></label><label>Text alignment<select id="editTextAlign"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label><label>Image alignment<select id="editImageAlign"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label><label>Image width <output id="editImageWidthValue">100%</output><input id="editImageWidth" type="range" min="25" max="100" value="100" /></label></fieldset>');
  $('#editFontSize').addEventListener('input', () => { $('#editFontSizeValue').textContent = `${$('#editFontSize').value}px`; });
  $('#editImageWidth').addEventListener('input', () => { $('#editImageWidthValue').textContent = `${$('#editImageWidth').value}%`; });
}
function defaultProducts() { return [{ name: 'Everyday object', description: 'A useful piece, made to last.', rating: '4.9', price: '₹1,299' }, { name: 'Weekend edition', description: 'Thoughtful details for slower days.', rating: '4.8', price: '₹1,899' }, { name: 'The essential set', description: 'A considered collection for your routine.', rating: '5.0', price: '₹2,499' }]; }
function importProjectFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const imported = data.format === 'cortexweb-template' ? data.project : data.projects?.[0];
      if (!imported || !imported.name || (!imported.builderPages && !imported.builderSections)) throw new Error('Invalid template');
      const project = JSON.parse(JSON.stringify(imported));
      project.id = Date.now(); project.name = `${project.name} (imported)`; project.status = 'In progress'; project.updated = 'Just now'; delete project.publishedUrl;
      projects.unshift(project); save(); renderAll(); openBuilder(project.id); showToast('Template imported into a new project.');
    } catch { showToast('That file is not a valid CortexWeb template.'); }
    event.target.value = '';
  };
  reader.readAsText(file);
}
function renderCanvas() {
  ensurePages();
  const sections = activeProject.builderSections || [];
  activeProject.builderSections = sections;
  $('#canvasEmpty').style.display = sections.length ? 'none' : 'flex';
  $('#builderCanvas').querySelectorAll('.canvas-section').forEach((node) => node.remove());
  sections.forEach((section, index) => $('#builderCanvas').insertAdjacentHTML('beforeend', sectionMarkup(section, index)));
  if (document.body.classList.contains('user-mode')) $$('#builderCanvas .section-controls').forEach((controls) => controls.insertAdjacentHTML('afterbegin', '<button class="duplicate-section" type="button" title="Duplicate section">＋</button>'));
  $$('#builderCanvas .canvas-section').forEach((section) => { section.addEventListener('click', (event) => { if (!event.target.closest('.section-controls') && !event.target.closest('.add-product')) selectSection(Number(section.dataset.sectionIndex)); }); section.addEventListener('dragstart', (event) => { event.dataTransfer.setData('application/x-cortex-section', section.dataset.sectionIndex); section.classList.add('dragging'); }); section.addEventListener('dragend', () => section.classList.remove('dragging')); section.querySelector('.remove-section').addEventListener('click', (event) => { event.stopPropagation(); removeSection(Number(section.dataset.sectionIndex)); }); section.querySelector('.duplicate-section')?.addEventListener('click', (event) => { event.stopPropagation(); duplicateSection(Number(section.dataset.sectionIndex)); }); section.querySelector('.add-product')?.addEventListener('click', (event) => { event.stopPropagation(); addProduct(Number(section.dataset.sectionIndex)); }); section.querySelectorAll('.move-section').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); moveSection(Number(section.dataset.sectionIndex), button.dataset.move); })); });
  save();
}
function duplicateSection(index) { const copy = JSON.parse(JSON.stringify(activeProject.builderSections[index])); activeProject.builderSections.splice(index + 1, 0, copy); activeProject.builderPages[activePageIndex].sections = activeProject.builderSections; selectedSection = index + 1; renderCanvas(); selectSection(selectedSection); showToast('Section duplicated.'); }
function removeSection(index) { const removed = activeProject.builderSections.splice(index, 1)[0]; activeProject.builderPages[activePageIndex].sections = activeProject.builderSections; selectedSection = null; $('#inspectorForm').classList.remove('visible'); $('#inspectorEmpty').style.display = 'block'; renderCanvas(); showToast(`${blockDefinitions.find((block) => block.type === removed.type)?.label || 'Section'} removed.`); }
function moveSection(index, direction) { const sections = activeProject.builderSections; const destination = direction === 'top' ? 0 : direction === 'bottom' ? sections.length - 1 : direction === 'up' ? index - 1 : index + 1; if (destination < 0 || destination >= sections.length || destination === index) return; const [moved] = sections.splice(index, 1); sections.splice(destination, 0, moved); activeProject.builderPages[activePageIndex].sections = sections; selectedSection = destination; renderCanvas(); selectSection(destination); showToast('Section moved.'); }
function addSection(type) {
  ensurePages();
  const definition = blockDefinitions.find((block) => block.type === type);
  const newSection = { type, order: definition.order, content: { heading: definition.heading, description: definition.description, button: definition.button, products: type === 'product' ? defaultProducts() : undefined, navLinks: type === 'nav' ? ['Home', 'Products', 'Services', 'About', 'Contact'] : undefined } };
  activeProject.builderPages[activePageIndex].sections = [...activeProject.builderPages[activePageIndex].sections, newSection];
  activeProject.builderSections = activeProject.builderPages[activePageIndex].sections;
  renderCanvas(); selectedSection = activeProject.builderSections.indexOf(newSection); selectSection(selectedSection); showToast(`${definition.label} added to your page.`);
}
function addProduct(sectionIndex) { const section = activeProject.builderSections[sectionIndex]; if (!section || section.type !== 'product') return; section.content.products = section.content.products || defaultProducts(); const number = section.content.products.length + 1; section.content.products.push({ name: `New product ${number}`, description: 'Add a short product description.', rating: '5.0', price: '₹999' }); activeProject.builderPages[activePageIndex].sections = activeProject.builderSections; selectedSection = sectionIndex; renderCanvas(); save(); showToast('Product added to this page.'); }
function selectSection(index) {
  addTimesNewRomanOption();
  addJustifyOption();
  moveApplyButtonToEnd();
  selectedSection = index; const section = activeProject.builderSections[index]; const content = section.content;
  addInspectorStyleControls(); $('#inspectorEmpty').style.display = 'none'; $('#inspectorForm').classList.add('visible'); $('#editHeading').value = content.heading; $('#editDescription').value = content.description; $('#editButton').value = content.button; $('#editLink').value = content.link || ''; $('#editBackground').value = content.background || '#ffffff'; $('#editTextColor').value = content.textColor || '#172320'; $('#editButtonColor').value = content.buttonColor || '#172320'; $('#editFontFamily').value = content.fontFamily || 'Manrope'; $('#editFontSize').value = content.fontSize || 14; $('#editFontSizeValue').textContent = `${$('#editFontSize').value}px`; $('#editTextAlign').value = content.textAlign || 'left'; $('#editImageAlign').value = content.imageAlign || 'left'; $('#editImageWidth').value = content.imageWidth || 100; $('#editImageWidthValue').textContent = `${$('#editImageWidth').value}%`; $('#uploadPreview').style.backgroundImage = content.image ? `url(${content.image})` : content.backgroundImage ? `url(${content.backgroundImage})` : ''; $('#uploadPreview').textContent = content.image || content.backgroundImage ? '' : 'Upload an image to preview it here.';
  $$('#builderCanvas .canvas-section').forEach((node, nodeIndex) => node.classList.toggle('selected', nodeIndex === index));
}
$('#builderCanvas').addEventListener('dragover', (event) => { event.preventDefault(); const target = event.target.closest('.canvas-section'); $$('#builderCanvas .canvas-section').forEach((section) => section.classList.remove('drop-target')); if (target) target.classList.add('drop-target'); });
$('#builderCanvas').addEventListener('drop', (event) => { event.preventDefault(); const movedIndex = Number(event.dataTransfer.getData('application/x-cortex-section')); if (Number.isInteger(movedIndex) && event.dataTransfer.types.includes('application/x-cortex-section')) { const target = event.target.closest('.canvas-section'); const sections = activeProject.builderSections; const [moved] = sections.splice(movedIndex, 1); let targetIndex = sections.length; if (target) { targetIndex = Number(target.dataset.sectionIndex); const insertAfter = event.clientY > target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2; if (insertAfter) targetIndex += 1; if (movedIndex < targetIndex) targetIndex -= 1; } sections.splice(Math.max(0, targetIndex), 0, moved); selectedSection = targetIndex; renderCanvas(); showToast('Section moved.'); } else { addSection(event.dataTransfer.getData('text/plain')); } });
function readImage(file, callback) { if (!file) return callback(null); const reader = new FileReader(); reader.onload = () => callback(reader.result); reader.readAsDataURL(file); }
function refreshInspectorPreview(content) { $('#uploadPreview').style.backgroundImage = content.image ? `url(${content.image})` : content.backgroundImage ? `url(${content.backgroundImage})` : ''; $('#uploadPreview').textContent = content.image || content.backgroundImage ? '' : 'Upload an image to preview it here.'; }
$('#editImage').addEventListener('change', (event) => readImage(event.target.files[0], (image) => { if (activeProject && selectedSection !== null) { activeProject.builderSections[selectedSection].content.image = image; activeProject.builderPages[activePageIndex].sections = activeProject.builderSections; save(); refreshInspectorPreview(activeProject.builderSections[selectedSection].content); renderCanvas(); selectSection(selectedSection); } }));
$('#editBackgroundImage').addEventListener('change', (event) => readImage(event.target.files[0], (image) => { if (activeProject && selectedSection !== null) { activeProject.builderSections[selectedSection].content.backgroundImage = image; activeProject.builderPages[activePageIndex].sections = activeProject.builderSections; save(); refreshInspectorPreview(activeProject.builderSections[selectedSection].content); renderCanvas(); selectSection(selectedSection); } }));
$('#inspectorForm').addEventListener('submit', (event) => { event.preventDefault(); const content = activeProject.builderSections[selectedSection].content; content.heading = $('#editHeading').value; content.description = $('#editDescription').value; content.button = $('#editButton').value; content.link = $('#editLink').value; content.background = $('#editBackground').value; content.textColor = $('#editTextColor').value; content.buttonColor = $('#editButtonColor').value; content.fontFamily = $('#editFontFamily').value; content.fontSize = Number($('#editFontSize').value); content.textAlign = $('#editTextAlign').value; content.imageAlign = $('#editImageAlign').value; content.imageWidth = Number($('#editImageWidth').value); save(); renderCanvas(); selectSection(selectedSection); showToast('Section styling and content updated.'); });
$('#closeInspector').addEventListener('click', () => { selectedSection = null; $('#inspectorForm').classList.remove('visible'); $('#inspectorEmpty').style.display = 'block'; $$('#builderCanvas .canvas-section').forEach((node) => node.classList.remove('selected')); });
$('#backToProjects').addEventListener('click', () => navigate('projects'));
$('#previewButton').addEventListener('click', () => { $('#builderView').classList.toggle('preview-mode'); showToast($('#builderView').classList.contains('preview-mode') ? 'Preview mode enabled.' : 'Back to editing.'); });
function renderHostedPage(pageIndex) { ensurePages(); const page = activeProject.builderPages[pageIndex]; const settings = activeProject.siteSettings || {}; const pageNav = activeProject.builderPages.map((item, index) => `<button class="hosted-page-tab ${index === pageIndex ? 'active' : ''}" data-hosted-page="${index}">${item.name}</button>`).join(''); const sections = page.sections.map((section, index) => sectionMarkup(section, index)).join(''); $('#hostedSite').innerHTML = `<nav class="hosted-page-nav">${pageNav}</nav><header class="hosted-site-intro"><h1>${settings.title || activeProject.name}</h1>${settings.description ? `<p>${settings.description}</p>` : ''}</header><div class="hosted-page-content">${sections}</div>`; $('#hostedSite').style.setProperty('--site-accent', settings.accent || '#d8f36b'); $('#hostedSite').querySelectorAll('.section-controls').forEach((control) => control.remove()); $('#hostedSite').querySelectorAll('.canvas-section').forEach((section) => { section.classList.remove('selected'); section.removeAttribute('draggable'); }); $('#hostedSite').querySelectorAll('.hosted-page-tab').forEach((tab) => tab.addEventListener('click', () => renderHostedPage(Number(tab.dataset.hostedPage)))); bindHostedInteractions(); }
function bindHostedInteractions() { $('#hostedSite').querySelectorAll('.ready-form').forEach((form) => { form.noValidate = true; form.addEventListener('submit', async (event) => { event.preventDefault(); clearFormError(form); const data = Object.fromEntries(new FormData(form)); const message = data.message || 'Account form submission'; const slug = activeProject?.slug || activeProject?.publishedUrl?.match(/\/site\/([^/?]+)/)?.[1]; try { if (backendEnabled && slug) { await apiRequest(`/api/public/${encodeURIComponent(slug)}/submissions`, { method: 'POST', body: JSON.stringify({ name: data.name || 'Website visitor', email: data.email, message, formType: form.dataset.formType }) }); } form.reset(); showToast('Thanks. Your submission was received.'); } catch (error) { showFormError(form, error.message); } }); }); $('#hostedSite').querySelectorAll('.faq-lines span').forEach((item) => item.addEventListener('click', () => { item.classList.toggle('expanded'); item.querySelector('b').textContent = item.classList.contains('expanded') ? '−' : '＋'; })); $('#hostedSite').querySelectorAll('.canvas-button[href="#"]').forEach((button) => button.addEventListener('click', (event) => { event.preventDefault(); showToast('Add a destination link in the section settings.'); })); }
function showHostedSite() { ensurePages(); renderHostedPage(activePageIndex); $('#hostedUrl').textContent = activeProject.publishedUrl; $('#hostedUrl').href = activeProject.publishedUrl; $('#hostedModal').classList.add('open'); }
function publishedUrlFor(project) { return project.publishedUrl || `${location.origin}${location.pathname}?site=${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`; }
async function publishCurrentSite() { if (!activeProject) { showToast('Open a project before publishing.'); return; } ensurePages(); try { setSaveState('Saving...'); if (backendEnabled) { await apiRequest(`/api/projects/${activeProject.id}`, { method: 'PUT', body: JSON.stringify({ content: { builderPages: activeProject.builderPages, builderTheme: activeProject.builderTheme, siteSettings: activeProject.siteSettings } }) }); const result = await apiRequest(`/api/projects/${activeProject.id}/publish`, { method: 'POST', body: JSON.stringify({}) }); const updated = backendProject(result.project); Object.assign(activeProject, updated); activeProject.publishedUrl = `${location.origin}${result.publicUrl}`; } else { activeProject.status = 'Live'; activeProject.publishedUrl = publishedUrlFor(activeProject); activeProject.publishedAt = new Date().toISOString(); save(); } setSaveState('Saved'); $('#publishedLinkBar').classList.add('visible'); $('#editorPublishedUrl').textContent = activeProject.publishedUrl; $('#editorPublishedUrl').href = activeProject.publishedUrl; showHostedSite(); showToast(`Website updated and published at ${activeProject.publishedUrl}`); } catch (error) { setSaveState('Save failed'); showToast(error.message); } }
async function copyPublishedLink() { const url = activeProject?.publishedUrl; if (!url) return; try { await navigator.clipboard.writeText(url); showToast('Published link copied.'); } catch { const helper = document.createElement('textarea'); helper.value = url; document.body.appendChild(helper); helper.select(); document.execCommand('copy'); helper.remove(); showToast('Published link copied.'); } }
$('#publishButton').addEventListener('click', publishCurrentSite);
$('#importFile').addEventListener('change', importProjectFile);
function addProfilePage() {
  if ($('#profileView')) return;
  $('.main-content').insertAdjacentHTML('beforeend', '<section class="page-view profile-view" id="profileView"><div class="profile-hero"><div><p class="eyebrow">Your account</p><h1>Your profile</h1><p class="heading-copy">Manage your identity and keep your website workspace personal.</p></div><button class="outline-button" id="profileBack">← Back to builder</button></div><div class="profile-grid"><div class="profile-card profile-identity"><div class="profile-avatar" id="profileAvatar">U</div><div><h2 id="profileNameDisplay">Website owner</h2><p id="profileEmailDisplay">you@example.com</p><p id="profileBioDisplay">Creator workspace</p></div><span class="profile-status">● Active account</span></div><form class="profile-card profile-form" id="profileForm"><h2>Customize your profile</h2><label>Full name<input id="profileName" required maxlength="60" /></label><label>Email address<input id="profileEmail" type="email" required maxlength="100" /></label><label>Workspace name<input id="profileWorkspace" required maxlength="60" /></label><label>Short bio<textarea id="profileBio" maxlength="120" placeholder="Tell visitors what you create"></textarea></label><label>Avatar color<input id="profileColor" type="color" value="#d8f36b" /></label><button class="primary-button" type="submit">Save profile</button><button class="outline-button danger-button" id="deleteAccountButton" type="button">Delete account</button></form><div class="profile-card profile-stats"><h2>Workspace snapshot</h2><div><strong id="profileProjectCount">0</strong><span>Projects</span></div><div><strong id="profileLiveCount">0</strong><span>Published sites</span></div><div><strong id="profileSectionCount">0</strong><span>Built sections</span></div></div><div class="profile-card profile-activity"><h2>Recent activity</h2><div id="profileActivity"></div></div></div></section>');
  const profileVisual = $('.auth-art').cloneNode(true); profileVisual.className = 'profile-visual'; $('.profile-grid').append(profileVisual);
  $('#profileColor').closest('label').style.display = 'none';
  $('#profileBack').addEventListener('click', () => navigate('builder'));
  $('#deleteAccountButton').addEventListener('click', deleteCurrentAccount);
  $('#profileForm').addEventListener('submit', (event) => { event.preventDefault(); const user = JSON.parse(localStorage.getItem('cortexweb_user') || '{}'); user.name = $('#profileName').value.trim(); user.email = $('#profileEmail').value.trim(); user.bio = $('#profileBio').value.trim(); user.avatarColor = $('#profileColor').value; user.role = 'user'; localStorage.setItem('cortexweb_user', JSON.stringify(user)); $('.user-profile strong').textContent = user.name; renderProfile(); showToast('Profile updated successfully.'); });
}
function renderProfile() {
  const user = JSON.parse(localStorage.getItem('cortexweb_user') || '{}');
  const initials = (user.name || 'User').split(' ').map((word) => word[0]).join('').slice(0, 2).toUpperCase();
  $('#profileAvatar').textContent = initials; $('#profileAvatar').style.backgroundColor = user.avatarColor || '#d8f36b'; $('#profileNameDisplay').textContent = user.name || 'Website owner'; $('#profileEmailDisplay').textContent = user.email || 'you@example.com'; $('#profileBioDisplay').textContent = user.bio || 'Creator workspace'; $('#profileName').value = user.name || ''; $('#profileEmail').value = user.email || ''; $('#profileBio').value = user.bio || ''; $('#profileColor').value = user.avatarColor || '#d8f36b';
  $('#profileProjectCount').textContent = projects.length; $('#profileLiveCount').textContent = projects.filter((project) => project.status === 'Live').length; $('#profileSectionCount').textContent = projects.reduce((total, project) => total + (project.builderPages || []).reduce((count, page) => count + page.sections.length, 0), 0); $('#profileActivity').innerHTML = activity.slice(0, 5).map((item) => `<div class="profile-activity-row"><span>${item.icon}</span><div><strong>${item.title}</strong><small>${item.detail}</small><time>${item.time}</time></div></div>`).join('');
}
async function deleteCurrentAccount() {
  const confirmed = window.confirm('This will permanently delete your account and all associated data. Continue?');
  if (!confirmed) return;
  try {
    if (backendEnabled) {
      await apiRequest('/api/auth/account', { method: 'DELETE' });
    }
    localStorage.removeItem('cortexweb_user');
    localStorage.removeItem('cortexweb_projects');
    localStorage.removeItem('cortexweb_connections');
    localStorage.removeItem('cortexweb_activity');
    backendEnabled = false;
    backendUser = null;
    csrfToken = null;
    document.body.classList.remove('user-mode');
    $('.auth-gate').classList.remove('hidden');
    navigate('builder');
    showToast('Account deleted.');
    setTimeout(() => window.location.reload(), 500);
  } catch (error) {
    showToast(error.message || 'Unable to delete account.');
  }
}
function logoutUser() { localStorage.removeItem('cortexweb_user'); document.body.classList.remove('user-mode'); $('.auth-gate').classList.remove('hidden'); navigate('builder'); showToast('You have been logged out.'); }
function addExportControls() {
  if (!document.body.classList.contains('user-mode') || $('#importTemplate')) return;
  const actions = $('.builder-actions');
  actions.insertAdjacentHTML('afterbegin', '<button class="outline-button" id="importTemplate">⇧ Upload template</button>');
  $('#importTemplate').addEventListener('click', () => $('#importFile').click());
  if (!$('#profileButton')) { actions.insertAdjacentHTML('beforeend', '<button class="outline-button" id="builtinTemplatesButton">▦ Inbuilt templates</button><button class="outline-button" id="leadsButton">✉ Leads</button><button class="outline-button" id="profileButton">◯ Profile</button><button class="outline-button logout-button" id="logoutButton">↪ Log out</button>'); $('#builtinTemplatesButton').addEventListener('click', () => { setupTemplateModal(); renderBuilderBlocks(); $('#templateModal').classList.add('open'); }); $('#leadsButton').addEventListener('click', () => { navigate('leads'); loadLeads(); }); $('#profileButton').addEventListener('click', () => { renderProfile(); navigate('profile'); $('#profileView').classList.add('active-view'); }); $('#logoutButton').addEventListener('click', logoutUser); }
}
$('#closeHosted').addEventListener('click', () => $('#hostedModal').classList.remove('open'));
$('#copyHostedUrl').addEventListener('click', async () => { const url = $('#hostedUrl').textContent; let copied = false; try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); copied = true; } } catch { copied = false; } if (!copied) { const helper = document.createElement('textarea'); helper.value = url; helper.setAttribute('readonly', ''); helper.style.position = 'fixed'; helper.style.opacity = '0'; document.body.appendChild(helper); helper.select(); copied = document.execCommand('copy'); helper.remove(); } showToast(copied ? 'Thank you for using CortexWeb. Hosted URL copied.' : 'Copy blocked by the browser. Select the URL to copy it.'); });
function applyRole(user) {
  const normalizedUser = { ...user, role: 'user' };
  localStorage.setItem('cortexweb_user', JSON.stringify(normalizedUser));
  document.body.classList.add('user-mode');
  $('.workspace-switcher strong').textContent = normalizedUser?.workspace || 'My workspace';
  $('.user-profile strong').textContent = normalizedUser?.name || 'Website owner';
  let userProject = projects.find((project) => project.client === normalizedUser.name) || projects[0];
  if (!userProject) { const initials = (normalizedUser.name || 'User').split(' ').map((word) => word[0]).join('').slice(0, 2).toUpperCase(); userProject = { id: Date.now(), name: 'My first website', client: normalizedUser.name || 'Website owner', type: 'Marketing website', status: 'In progress', initials, color: 'purple', updated: 'Just now', brief: 'Your starter website is ready to customize.' }; projects = [userProject]; save(); renderAll(); }
  openBuilder(userProject.id);
}
function switchAuthView(view) {
  const tabs = $$('.auth-tab');
  const login = $('#loginForm');
  const register = $('#registerForm');
  const isLogin = view === 'login';
  tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.authView === view));
  login.classList.toggle('visible', isLogin);
  register.classList.toggle('visible', !isLogin);
}

let registrationAwaitingOtp = false;
let pendingRegistrationData = null;
async function sendRegistrationOtp(data) {
  await apiRequest('/api/auth/otp/send', { method: 'POST', body: JSON.stringify(data) });
  registrationAwaitingOtp = true;
  $('#registerForm').querySelectorAll('label').forEach((label) => { label.hidden = true; label.style.display = 'none'; });
  $('#registerOtpField').hidden = false;
  $('#registerOtpField').style.display = 'grid';
  $('#registerOtpCode').required = true;
  $('#resendRegisterOtp').hidden = false;
  $('#resendRegisterOtp').style.display = 'inline-flex';
  $('#registerForm .auth-submit').innerHTML = 'Verify code <span>→</span>';
  $('#registerOtpCode').focus();
}
$('#registerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  if (!registrationAwaitingOtp && data.password !== data.confirmPassword) { showAuthError('Passwords do not match.'); return; }
  try {
    if (!registrationAwaitingOtp) {
      pendingRegistrationData = data;
      await sendRegistrationOtp(pendingRegistrationData);
      showToast(`A verification code was sent to ${data.email}.`);
      return;
    }
    const result = await apiRequest('/api/auth/otp/verify', { method: 'POST', body: JSON.stringify({ code: data.verificationCode }) });
    backendEnabled = true;
    backendUser = result.user;
    await hydrateBackend();
    $('.auth-gate').classList.add('hidden');
    applyRole(backendUser);
    showToast('Email verified. Your workspace is ready.');
  } catch (error) {
    if (!backendEnabled && !registrationAwaitingOtp && error.message === 'Backend unavailable.') {
      const passwordHash = await hashPassword(data.password);
      if (!passwordHash) { showAuthError('Secure password storage requires a secure browser context.'); return; }
      const user = { name: data.name, email: data.email, workspace: data.workspace, projectName: data.projectName, projectType: data.projectType, passwordHash, role: 'user' };
      localStorage.setItem('cortexweb_user', JSON.stringify(user));
      const initials = user.name.split(' ').map((word) => word[0]).join('').slice(0, 2).toUpperCase();
      projects = [{ id: Date.now(), name: user.projectName, client: user.name, type: user.projectType, status: 'In progress', initials, color: 'purple', updated: 'Just now', brief: 'Your first CortexWeb project is ready. Add sections, edit the copy, and publish when it feels right.' }];
      activity = [{ icon: '✦', title: 'Workspace created', detail: `${user.projectName} · ready to build`, time: 'Just now' }];
      save(); renderAll(); switchAuthView('login');
      $('#loginForm input[name="email"]').value = user.email;
      $('#loginForm input[name="password"]').value = '';
      showToast('Account created. Please log in to continue.');
      return;
    }
    showAuthError(error.message);
  }
});
function setupAuth() {
  const panel = $('.auth-panel');
  panel.querySelector('.auth-copy > p:last-child').textContent = 'Start with a blank page or choose a multi-page template. Edit each section and publish when your site is ready.';
  $('#connectionModal .modal-copy').textContent = 'This records the intended database and environment only. Live connection testing is not included in this prototype.';
  panel.querySelector('.auth-copy').insertAdjacentHTML('afterend', '<div class="auth-tabs"><button type="button" class="auth-tab active" data-auth-view="login">Log in</button><button type="button" class="auth-tab" data-auth-view="register">Create account</button></div><form id="loginForm" class="register-form auth-form"><label>Email address<input name="email" type="email" required placeholder="you@example.com" /></label><label>Password<input name="password" type="password" required placeholder="Enter your password" /></label><label class="remember-field"><input name="remember" type="checkbox" /> Remember me</label><button class="primary-button auth-submit" type="submit">Log in <span>→</span></button><p class="auth-note">CortexWeb demo authentication stores only a browser-local password hash.</p></form>');
  $('#loginForm .auth-note').textContent = 'Accounts use server-side password hashing when the Node server is available.';
  const register = $('#registerForm');
  register.classList.add('auth-form');
  register.querySelector('.auth-submit').insertAdjacentHTML('beforebegin', '<label id="registerOtpField" hidden>Email verification code<input id="registerOtpCode" name="verificationCode" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="6-digit code" /></label><button id="resendRegisterOtp" class="outline-button auth-otp-resend" type="button" hidden>Send a new code</button>');
  $('#registerOtpField').style.display = 'none';
  $('#resendRegisterOtp').style.display = 'none';
  $('#resendRegisterOtp').addEventListener('click', async () => { try { await sendRegistrationOtp(pendingRegistrationData); $('#registerOtpCode').value = ''; showToast('A new verification code was sent.'); } catch (error) { showAuthError(error.message); } });
  const login = $('#loginForm');
  login.classList.add('visible');
  $$('.auth-tab').forEach((tab) => tab.addEventListener('click', () => { const loginView = tab.dataset.authView === 'login'; $$('.auth-tab').forEach((item) => item.classList.toggle('active', item === tab)); login.classList.toggle('visible', loginView); register.classList.toggle('visible', !loginView); }));
  login.addEventListener('submit', async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.target)); try { const result = await apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }); backendEnabled = true; backendUser = result.user; await hydrateBackend(); $('.auth-gate').classList.add('hidden'); applyRole(backendUser); showToast(`Welcome back, ${backendUser.name.split(' ')[0]}.`); } catch (error) { if (backendEnabled || error.message !== 'Backend unavailable.') { showAuthError(error.message); return; } const savedUser = JSON.parse(localStorage.getItem('cortexweb_user') || 'null'); const passwordHash = await hashPassword(data.password); if (!savedUser || !passwordHash || savedUser.email.toLowerCase() !== data.email.toLowerCase() || savedUser.passwordHash !== passwordHash) { showAuthError('Email or password is incorrect.'); return; } $('.auth-gate').classList.add('hidden'); applyRole(savedUser); showToast(`Welcome back, ${savedUser.name.split(' ')[0]}.`); } });
}
function showAuthError(message) { const form = $('.auth-form.visible') || $('#loginForm'); let note = form.querySelector('.auth-error'); if (!note) { note = document.createElement('p'); note.className = 'auth-error'; form.appendChild(note); } note.textContent = message; note.hidden = false; }
setupAuth();
async function initializeBackend() {
  try {
    const csrfResponse = await fetch('/api/csrf', { credentials: 'same-origin' });
    if (!csrfResponse.ok) return;
    csrfToken = (await csrfResponse.json()).csrfToken;
    const session = await apiRequest('/api/me');
    backendEnabled = true;
    if (session.user) { backendUser = session.user; await hydrateBackend(); $('.auth-gate').classList.add('hidden'); applyRole(backendUser); }
  } catch { backendEnabled = false; }
}
initializeBackend();
const storedUser = JSON.parse(localStorage.getItem('cortexweb_user') || 'null');
const publishedSlug = new URLSearchParams(location.search).get('site') || location.pathname.match(/^\/site\/([^/]+)$/)?.[1];
async function initializePublicSite() { if (!publishedSlug) return; try { const result = await apiRequest(`/api/public/${encodeURIComponent(publishedSlug)}`); const publishedProject = backendProject(result.website); projects = [publishedProject]; activeProject = publishedProject; document.body.classList.remove('user-mode'); document.body.classList.add('public-mode'); $('.auth-gate').classList.add('hidden'); openBuilder(publishedProject.id); showHostedSite(); } catch { const publishedProject = projects.find((project) => project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') === publishedSlug); if (publishedProject) { document.body.classList.remove('user-mode'); document.body.classList.add('public-mode'); $('.auth-gate').classList.add('hidden'); openBuilder(publishedProject.id); showHostedSite(); } } }
initializePublicSite();
window.addEventListener('storage', (event) => { if (!document.body.classList.contains('public-mode') || event.key !== 'cortexweb_projects') return; projects = JSON.parse(event.newValue || '[]'); const latest = projects.find((project) => project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') === publishedSlug); if (latest) { activeProject = latest; activePageIndex = 0; showHostedSite(); } });
