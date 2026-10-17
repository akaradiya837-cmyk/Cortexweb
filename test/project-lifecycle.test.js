const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const test = require('node:test');
const { api, requestHandler } = require('../server');
const { handleEmptySaveConfirmation, loadAndApplySavedProject } = require('../project-save-recovery');

function responseRecorder() {
  return {
    statusCode: null,
    headers: {},
    body: '',
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(body = '') {
      this.body = body;
    }
  };
}

function request(method, url, body, headers = {}) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost', ...headers };
  return req;
}

function projectDatabase(initialContent) {
  const project = {
    id: 41,
    user_id: 7,
    name: 'BHSJ',
    client: 'BHSJ',
    type: 'Marketing website',
    brief: 'A test site',
    status: 'Draft',
    slug: null,
    content_json: JSON.stringify(initialContent),
    updated_at: '2026-10-17 12:00:00'
  };
  const activity = [];

  const execute = async (sql, values = []) => {
    if (sql.startsWith('SELECT * FROM projects WHERE id = ? AND user_id = ?')) {
      return [[project.id === Number(values[0]) && project.user_id === values[1] ? { ...project } : []].flat()];
    }
    if (sql.startsWith('SELECT content_json FROM projects WHERE id = ? AND user_id = ? FOR UPDATE')) {
      return [[project.id === Number(values[0]) && project.user_id === values[1] ? { content_json: project.content_json } : []].flat()];
    }
    if (sql.startsWith('UPDATE projects SET name = COALESCE')) {
      const [name, client, type, brief, contentJson, status] = values;
      if (name !== null) project.name = name;
      if (client !== null) project.client = client;
      if (type !== null) project.type = type;
      if (brief !== null) project.brief = brief;
      if (contentJson !== null) project.content_json = contentJson;
      project.status = status;
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT * FROM projects WHERE id = ?')) {
      return [project.id === Number(values[0]) ? [{ ...project }] : []];
    }
    if (sql.startsWith('SELECT id FROM projects WHERE slug = ? AND id != ?')) return [[]];
    if (sql.startsWith('UPDATE projects SET slug = ?, status = ?')) {
      project.slug = values[0];
      project.status = values[1];
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT * FROM projects WHERE slug = ? AND status = ?')) {
      return [[project.slug === values[0] && project.status === values[1] ? { ...project } : []].flat()];
    }
    if (sql.startsWith('SELECT * FROM projects WHERE user_id = ?')) {
      return [[project.user_id === values[0] ? { ...project } : []].flat()];
    }
    if (sql.startsWith('INSERT INTO activity_logs')) {
      activity.push(values);
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL in test fake: ${sql}`);
  };

  return {
    project,
    activity,
    execute,
    async getConnection() {
      return {
        execute,
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {}
      };
    }
  };
}

async function callApi(database, method, url, body, userId = 7) {
  const res = responseRecorder();
  await api(request(method, url, body, { 'x-csrf-token': 'test-csrf' }), res, { userId, csrf: 'test-csrf' }, url, database);
  return { ...res, payload: res.body ? JSON.parse(res.body) : null };
}

test('API requests are dispatched through the HTTP request handler', async () => {
  const res = responseRecorder();
  await requestHandler(request('GET', '/api/csrf'), res);
  assert.equal(res.statusCode, 200);
  assert.ok(JSON.parse(res.body).csrfToken);
});

test('saving a project preserves its sections through authenticated and public loads', async () => {
  const original = { builderPages: [{ name: 'Home', sections: [{ type: 'hero', content: { heading: 'Saved design' } }] }] };
  const database = projectDatabase(original);
  const updatedContent = { builderPages: [{ name: 'Home', sections: [{ type: 'hero', content: { heading: 'Updated design' } }] }] };

  const saved = await callApi(database, 'PUT', '/api/projects/41', { content: updatedContent });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.payload.project.content, updatedContent);

  const loaded = await callApi(database, 'GET', '/api/projects');
  assert.equal(loaded.statusCode, 200);
  assert.deepEqual(loaded.payload.projects[0].content, updatedContent);

  const published = await callApi(database, 'POST', '/api/projects/41/publish', {});
  assert.equal(published.statusCode, 200);
  assert.deepEqual(published.payload.project.content, updatedContent);

  const publicSite = await callApi(database, 'GET', '/api/public/bhsj');
  assert.equal(publicSite.statusCode, 200);
  assert.deepEqual(publicSite.payload.website.content, updatedContent);
});

test('empty editor saves cannot silently replace a previously saved design', async () => {
  const original = { builderPages: [{ name: 'Home', sections: [{ type: 'hero', content: { heading: 'Keep this' } }] }] };
  const database = projectDatabase(original);
  const emptyContent = { builderPages: [{ name: 'Home', sections: [] }] };

  const rejected = await callApi(database, 'PUT', '/api/projects/41', { content: emptyContent });
  assert.equal(rejected.statusCode, 409);
  assert.equal(rejected.payload.code, 'EMPTY_CONTENT_REQUIRES_CONFIRMATION');
  assert.deepEqual(JSON.parse(database.project.content_json), original);

  const confirmed = await callApi(database, 'PUT', '/api/projects/41', { content: emptyContent, confirmEmptyContent: true });
  assert.equal(confirmed.statusCode, 200);
  assert.deepEqual(confirmed.payload.project.content, emptyContent);
});

test('legacy builderSections are protected from an empty modern page save', async () => {
  const legacyContent = { builderSections: [{ type: 'hero', content: { heading: 'Legacy design' } }] };
  const database = projectDatabase(legacyContent);
  const response = await callApi(database, 'PUT', '/api/projects/41', {
    content: { builderPages: [{ name: 'Home', sections: [] }] }
  });

  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(database.project.content_json), legacyContent);
});

test('an empty builder page list is rejected as invalid content', async () => {
  const database = projectDatabase({ builderPages: [{ name: 'Home', sections: [{ type: 'hero' }] }] });
  const response = await callApi(database, 'PUT', '/api/projects/41', { content: { builderPages: [] } });
  assert.equal(response.statusCode, 422);
  assert.equal(database.project.content_json, JSON.stringify({ builderPages: [{ name: 'Home', sections: [{ type: 'hero' }] }] }));
});

test('Cancel reloads the saved project and never confirms empty replacement', async () => {
  let replaceCount = 0;
  let appliedProject;
  const result = await handleEmptySaveConfirmation({
    confirmReplacement: () => false,
    replaceWithEmpty: async () => { replaceCount += 1; return true; },
    reloadSavedProject: async () => {
      await loadAndApplySavedProject(41, async () => [
        { id: 42, content: { builderPages: [] } },
        { id: 41, content: { builderPages: [{ name: 'Contact', sections: [{ type: 'hero' }] }] } }
      ], async (project) => { appliedProject = project; });
    }
  });

  assert.equal(result, 'reloaded');
  assert.equal(appliedProject.id, 41);
  assert.equal(appliedProject.content.builderPages[0].sections.length, 1);
  assert.equal(replaceCount, 0);
});

test('reload failure propagates without applying a fallback project', async () => {
  const reloadError = new Error('backend unavailable');
  let appliedProject;
  let replaceCount = 0;
  await assert.rejects(handleEmptySaveConfirmation({
    confirmReplacement: () => false,
    replaceWithEmpty: async () => { replaceCount += 1; return true; },
    reloadSavedProject: async () => loadAndApplySavedProject(41, async () => { throw reloadError; }, async (project) => { appliedProject = project; })
  }), reloadError);
  assert.equal(replaceCount, 0);
  assert.equal(appliedProject, undefined);
});

test('only explicit confirmation performs an empty replacement', async () => {
  let replacementCount = 0;
  let reloadCount = 0;
  const result = await handleEmptySaveConfirmation({
    confirmReplacement: () => true,
    replaceWithEmpty: async () => { replacementCount += 1; return true; },
    reloadSavedProject: async () => { reloadCount += 1; }
  });

  assert.equal(result, 'replaced');
  assert.equal(replacementCount, 1);
  assert.equal(reloadCount, 0);
});
