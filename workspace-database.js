const crypto = require('node:crypto');
const dns = require('node:dns/promises');
const net = require('node:net');
const mysql = require('mysql2/promise');

const columnTypes = new Map([
  ['TEXT', 'TEXT'],
  ['VARCHAR', 'VARCHAR(255)'],
  ['INT', 'INT'],
  ['DECIMAL', 'DECIMAL(12,2)'],
  ['BOOLEAN', 'BOOLEAN'],
  ['DATE', 'DATE'],
  ['DATETIME', 'DATETIME'],
]);

function encryptionKey() {
  const value = process.env.DATABASE_ENCRYPTION_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('Set DATABASE_ENCRYPTION_KEY to 64 hexadecimal characters before saving a database connection.');
  return Buffer.from(value, 'hex');
}

function encryptCredentials(credentials) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
  return JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') });
}

function decryptCredentials(value) {
  const encrypted = JSON.parse(value);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(encrypted.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.data, 'base64')), decipher.final()]).toString('utf8'));
}

function isPublicIpv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = octets;
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && octets[2] === 113)
  );
}

async function publicIpv4For(host) {
  const addressType = net.isIP(host);
  if (addressType === 4) {
    if (!isPublicIpv4(host)) throw new Error('Use a publicly reachable MySQL host.');
    return host;
  }
  if (addressType === 6 || !/^[a-z0-9.-]{1,253}$/i.test(host) || host.includes('..')) throw new Error('Enter a valid public MySQL hostname.');
  const records = await dns.lookup(host, { all: true, family: 4, verbatim: true });
  if (!records.length || records.some(({ address }) => !isPublicIpv4(address))) throw new Error('The MySQL hostname must resolve only to public IPv4 addresses.');
  return records[0].address;
}

async function createExternalPool(credentials, database) {
  const address = await publicIpv4For(credentials.host);
  return mysql.createPool({
    host: address,
    port: credentials.port,
    user: credentials.username,
    password: credentials.password,
    ...(database ? { database } : {}),
    ssl: { rejectUnauthorized: true, servername: net.isIP(credentials.host) ? undefined : credentials.host },
    waitForConnections: false,
    connectionLimit: 2,
    connectTimeout: 10000,
    timezone: 'Z',
    dateStrings: true,
  });
}

function hostedMySqlConnectionOptions() {
  const host = String(process.env.HOSTED_MYSQL_HOST || '').trim();
  const port = Number(process.env.HOSTED_MYSQL_PORT || 3306);
  const sslEnabled = process.env.HOSTED_MYSQL_SSL === 'true';
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Configure HOSTED_MYSQL_HOST and a valid HOSTED_MYSQL_PORT to enable CortexWeb-hosted databases.');
  }
  if (!sslEnabled && !['localhost', '127.0.0.1', '::1'].includes(host.toLowerCase())) {
    throw new Error('Enable HOSTED_MYSQL_SSL when HOSTED_MYSQL_HOST is not a loopback address.');
  }
  return {
    host,
    port,
    ...(sslEnabled ? { ssl: { rejectUnauthorized: true, servername: net.isIP(host) ? undefined : host } } : {}),
  };
}

function createManagedPool(database, credentials) {
  const options = hostedMySqlConnectionOptions();
  const username = credentials?.username || process.env.HOSTED_MYSQL_USER;
  const password = credentials?.password || process.env.HOSTED_MYSQL_PASSWORD;
  if (!username || !password) {
    throw new Error('Configure HOSTED_MYSQL_USER and HOSTED_MYSQL_PASSWORD to provision CortexWeb-hosted databases.');
  }
  if (credentials && (credentials.host !== options.host || Number(credentials.port) !== options.port)) {
    throw new Error('The saved database host no longer matches HOSTED_MYSQL_HOST and HOSTED_MYSQL_PORT.');
  }
  return mysql.createPool({
    ...options,
    user: username,
    password,
    ...(database ? { database } : {}),
    waitForConnections: false,
    connectionLimit: 2,
    connectTimeout: 10000,
    timezone: 'Z',
    dateStrings: true,
  });
}

function validIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(value);
}

function quoteIdentifier(value) {
  if (!validIdentifier(value)) throw new Error('Invalid database identifier.');
  return `\`${value}\``;
}

function validateColumns(columns) {
  if (!Array.isArray(columns) || columns.length < 1 || columns.length > 50) return { error: 'Add between 1 and 50 columns.' };
  const names = new Set(['id']);
  const normalized = [];
  for (const column of columns) {
    const name = String(column?.name || '').trim();
    const type = String(column?.type || '').toUpperCase();
    if (!validIdentifier(name) || names.has(name.toLowerCase()) || !columnTypes.has(type)) return { error: 'Each column needs a unique valid name and a supported type.' };
    names.add(name.toLowerCase());
    normalized.push({ name, type });
  }
  return { columns: normalized };
}

function createTableSql(tableName, columns) {
  const fields = [
    '`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT',
    ...columns.map((column) => `${quoteIdentifier(column.name)} ${columnTypes.get(column.type)} NULL`),
    'PRIMARY KEY (`id`)',
  ];
  return `CREATE TABLE ${quoteIdentifier(tableName)} (${fields.join(', ')}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
}

function validateRow(row, columns) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return { error: 'Each row must be an object.' };
  const allowed = new Set(columns.map((column) => column.name));
  if (Object.keys(row).some((key) => !allowed.has(key))) return { error: 'A row contains a column that does not exist in this table.' };
  const values = {};
  for (const column of columns) {
    const value = row[column.name] ?? null;
    if (value === null) {
      values[column.name] = null;
      continue;
    }
    if (column.type === 'INT') {
      if (!Number.isSafeInteger(Number(value))) return { error: `${column.name} must be a whole number.` };
      values[column.name] = Number(value);
    } else if (column.type === 'DECIMAL') {
      if (value === '' || !Number.isFinite(Number(value))) return { error: `${column.name} must be a number.` };
      values[column.name] = Number(value);
    } else if (column.type === 'BOOLEAN') {
      if (![true, false, 1, 0, '1', '0', 'true', 'false'].includes(value)) return { error: `${column.name} must be true or false.` };
      values[column.name] = value === true || value === 1 || value === '1' || value === 'true';
    } else {
      values[column.name] = String(value);
    }
  }
  return { values };
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `CONVERT(X'${Buffer.from(String(value), 'utf8').toString('hex')}' USING utf8mb4)`;
}

function exportSql(tableName, columns, rows) {
  const create = createTableSql(tableName, columns);
  const inserts = rows.map((row) => {
    const names = ['id', ...columns.map((column) => column.name)];
    const values = names.map((name) => sqlLiteral(row[name]));
    return `INSERT INTO ${quoteIdentifier(tableName)} (${names.map(quoteIdentifier).join(', ')}) VALUES (${values.join(', ')});`;
  });
  return [`-- CortexWeb SQL export v1`, `${create};`, ...inserts, ''].join('\n');
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let inHex = false;
  for (const character of sql) {
    if (character === ';' && !inHex) {
      if (current.trim()) statements.push(current.trim());
      current = '';
    } else {
      current += character;
      if (character === "'") inHex = !inHex;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

function parseSqlValue(value) {
  const text = value.trim();
  if (text === 'NULL') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const hex = text.match(/^CONVERT\(X'([a-f0-9]*)' USING utf8mb4\)$/i);
  if (!hex) throw new Error('SQL import contains an unsupported value.');
  return Buffer.from(hex[1], 'hex').toString('utf8');
}

function splitSqlList(value) {
  const parts = [];
  let start = 0;
  let inHex = false;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "'") inHex = !inHex;
    if (!inHex && value[index] === '(') depth += 1;
    if (!inHex && value[index] === ')') depth -= 1;
    if (value[index] === ',' && !inHex && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function parseSqlExport(sql) {
  if (typeof sql !== 'string' || Buffer.byteLength(sql, 'utf8') > 1_500_000) throw new Error('SQL import must be smaller than 1.5 MB.');
  const statements = splitSqlStatements(sql.replace(/^\s*--[^\n]*(?:\n|$)/gm, ''));
  const create = statements.find((statement) => /^CREATE TABLE\b/i.test(statement));
  const match = create?.match(/^CREATE TABLE `([A-Za-z][A-Za-z0-9_]{0,62})` \((.*)\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci$/i);
  if (!match) throw new Error('SQL import must include a CortexWeb table schema.');
  const fields = splitSqlList(match[2]);
  if (fields[0] !== '`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT' || fields[fields.length - 1] !== 'PRIMARY KEY (`id`)') {
    throw new Error('SQL import contains an unsupported table schema.');
  }
  const typeNames = new Map([...columnTypes].map(([name, sqlType]) => [sqlType, name]));
  const columns = [];
  for (const field of fields.slice(1, -1)) {
    const column = field.match(/^`([A-Za-z][A-Za-z0-9_]{0,62})` (TEXT|VARCHAR\(255\)|INT|DECIMAL\(12,2\)|BOOLEAN|DATE|DATETIME) NULL$/i);
    if (!column || !typeNames.has(column[2].toUpperCase())) throw new Error('SQL import contains an unsupported column definition.');
    columns.push({ name: column[1], type: typeNames.get(column[2].toUpperCase()) });
  }
  const validated = validateColumns(columns);
  if (validated.error) throw new Error(validated.error);
  return { tableName: match[1], columns: validated.columns };
}

function importSql(sql, tableName, columns) {
  if (typeof sql !== 'string' || Buffer.byteLength(sql, 'utf8') > 1_500_000) throw new Error('SQL import must be smaller than 1.5 MB.');
  const expectedCreate = createTableSql(tableName, columns).replace(/\s+/g, ' ').toLowerCase();
  const rows = [];
  for (const statement of splitSqlStatements(sql.replace(/^\s*--[^\n]*(?:\n|$)/gm, ''))) {
    if (statement.startsWith('--')) continue;
    if (/^CREATE TABLE\b/i.test(statement)) {
      if (statement.replace(/\s+/g, ' ').toLowerCase() !== expectedCreate) throw new Error('SQL schema does not match the selected table.');
      continue;
    }
    const match = statement.match(/^INSERT INTO `([A-Za-z][A-Za-z0-9_]{0,62})` \(([^)]+)\) VALUES \((.*)\)$/i);
    if (!match || match[1] !== tableName) throw new Error('SQL import accepts only table exports generated by CortexWeb.');
    const names = match[2].split(',').map((name) => name.trim().replace(/^`|`$/g, ''));
    const expected = ['id', ...columns.map((column) => column.name)];
    if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) throw new Error('SQL columns do not match the selected table.');
    const values = splitSqlList(match[3]).map(parseSqlValue);
    if (values.length !== names.length) throw new Error('SQL row has the wrong number of values.');
    const row = Object.fromEntries(names.map((name, index) => [name, values[index]]));
    const validated = validateRow(Object.fromEntries(columns.map((column) => [column.name, row[column.name]])), columns);
    if (validated.error) throw new Error(validated.error);
    rows.push({ id: Number(row.id), ...validated.values });
    if (rows.length > 5000) throw new Error('SQL import is limited to 5,000 rows.');
  }
  return rows;
}

module.exports = {
  createExternalPool,
  createManagedPool,
  createTableSql,
  decryptCredentials,
  encryptCredentials,
  exportSql,
  hostedMySqlConnectionOptions,
  importSql,
  parseSqlExport,
  quoteIdentifier,
  validIdentifier,
  validateColumns,
  validateRow,
};
