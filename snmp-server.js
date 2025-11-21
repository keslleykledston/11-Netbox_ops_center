// server setup and middlewares
import express from 'express';
import cors from 'cors';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const snmp = require('net-snmp');

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

// Constantes configuráveis
const SNMP_MAX_REPETITIONS = Number(process.env.SNMP_MAX_REPETITIONS ?? 20);
const SNMP_GLOBAL_TIMEOUT_MS = Number(process.env.SNMP_GLOBAL_TIMEOUT_MS ?? 60000);

// Startup validation and summary (env is loaded by server/snmp-entry.js)
(() => {
  const port = process.env.SNMP_SERVER_PORT ?? 3001;
  const rep = process.env.SNMP_MAX_REPETITIONS ?? 20;
  const tout = process.env.SNMP_GLOBAL_TIMEOUT_MS ?? 60000;
  console.log(`[ENV] SNMP gateway: PORT=${port} MAX_REPETITIONS=${rep} TIMEOUT_MS=${tout}`);
  const np = Number(port);
  if (!Number.isFinite(np) || np <= 0) {
    console.warn(`[ENV][WARN] Invalid SNMP_SERVER_PORT='${port}', defaulting to 3001`);
  }
  const nr = Number(rep);
  if (!Number.isFinite(nr) || nr < 1) console.warn(`[ENV][WARN] SNMP_MAX_REPETITIONS should be >=1 (current='${rep}')`);
  const nt = Number(tout);
  if (!Number.isFinite(nt) || nt < 1000) console.warn(`[ENV][WARN] SNMP_GLOBAL_TIMEOUT_MS seems too low (current='${tout}')`);
})();

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(label || `Timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      }
    );
  });
}

function walk(session, oid, maxRepetitions = SNMP_MAX_REPETITIONS) {
  return new Promise((resolve, reject) => {
    const rows = [];
    session.walk(
      oid,
      maxRepetitions,
      (varbinds) => {
        rows.push(...varbinds);
      },
      (error) => {
        error ? reject(error) : resolve(rows);
      }
    );
  });
}

function tableColumns(session, baseOid, columns, maxRepetitions = SNMP_MAX_REPETITIONS) {
  return new Promise((resolve, reject) => {
    session.tableColumns(baseOid, columns, maxRepetitions, (error, table) => {
      if (error) return reject(error);
      resolve(table);
    });
  });
}

function oidLastIndex(oid) {
  const parts = String(oid).split('.');
  return parts[parts.length - 1];
}

function bufToIp(value) {
  if (Buffer.isBuffer(value)) {
    if (value.length === 4) return Array.from(value).join('.');
    return Array.from(value).map((b) => b.toString(16).padStart(2, '0')).join(':');
  }
  return String(value);
}

const defaultOptions = {
  version: snmp.Version2c,
  timeout: 5000,
  retries: 1,
  transport: 'udp4',
};

// Helper GETNEXT (subtree), equivalente ao snmpwalk padrão
function subtree(session, oid) {
  return new Promise((resolve, reject) => {
    const rows = [];
    session.subtree(
      oid,
      (varbinds) => rows.push(...varbinds),
      (error) => error ? reject(error) : resolve(rows)
    );
  });
}

// Descoberta de interfaces com fallback robusto
app.get('/api/snmp/interfaces', async (req, res) => {
  console.log(`[HTTP] ${req.method} ${req.url} query=${JSON.stringify(req.query)}`);
  const ip = req.query.ip;
  const community = req.query.community;
  const port = Number(req.query.port) || 161;

  if (!ip || !community) {
    return res.status(400).json({ error: 'Missing ip or community' });
  }

  const session = snmp.createSession(ip, community, { ...defaultOptions, port });

  try {
    console.log(`[SNMP] interfaces: ip=${ip} community=${community} port=${port}`);

    // Preferir GETNEXT (subtree) baseado no snmpwalk que funciona
    const nameRows = await withTimeout(
      subtree(session, '1.3.6.1.2.1.31.1.1.1.1'),
      SNMP_GLOBAL_TIMEOUT_MS,
      'SNMP ifName subtree timeout'
    );

    let interfaces = [];

    if (nameRows.length > 0) {
      console.log(`[SNMP] ifName rows=${nameRows.length} (via subtree)`);

      const [aliasRows, descrRows, typeRows] = await withTimeout(
        Promise.all([
          subtree(session, '1.3.6.1.2.1.31.1.1.1.18').catch(() => []), // ifAlias
          subtree(session, '1.3.6.1.2.1.2.2.1.2'),                      // ifDescr
          subtree(session, '1.3.6.1.2.1.2.2.1.3'),                      // ifType
        ]),
        SNMP_GLOBAL_TIMEOUT_MS,
        'SNMP interface enrich timeout'
      );

      console.log(`[SNMP] enrich counts: ifAlias=${aliasRows.length} ifDescr=${descrRows.length} ifType=${typeRows.length}`);

      const nameMap = {};
      const aliasMap = {};
      const descrMap = {};
      const typeMap = {};

      nameRows.forEach(vb => { nameMap[oidLastIndex(vb.oid)] = String(vb.value); });
      aliasRows.forEach(vb => { aliasMap[oidLastIndex(vb.oid)] = String(vb.value); });
      descrRows.forEach(vb => { descrMap[oidLastIndex(vb.oid)] = String(vb.value); });
      typeRows.forEach(vb => { typeMap[oidLastIndex(vb.oid)] = Number(vb.value); });

      const indexes = Object.keys(nameMap);
      interfaces = indexes.map(idx => ({
        index: String(idx),
        name: nameMap[idx] || '',
        desc: aliasMap[idx] || descrMap[idx] || '',
        type: Number(typeMap[idx] || 0),
      }));
    } else {
      console.log('[SNMP] ifName subtree vazio, tentando tableColumns');

      const [ifTable, ifX] = await withTimeout(
        Promise.all([
          tableColumns(session, '1.3.6.1.2.1.2.2.1', [1, 2, 3]).then(t => {
            console.log(`[SNMP] ifTable rows=${Object.keys(t).length}`);
            return t;
          }),
          tableColumns(session, '1.3.6.1.2.1.31.1.1.1', [1, 18]).then(t => {
            console.log(`[SNMP] ifXTable rows=${Object.keys(t).length}`);
            return t;
          }).catch(e => {
            console.warn(`[SNMP] ifXTable failed: ${String(e?.message || e)}`);
            return {};
          }),
        ]),
        SNMP_GLOBAL_TIMEOUT_MS,
        'SNMP interfaces timeout'
      );

      interfaces = Object.keys(ifTable).map((idx) => {
        const row = ifTable[idx] || {};
        const indexVb = row[1];
        const descrVb = row[2];
        const typeVb = row[3];
        const nameVb = ifX?.[idx]?.[1];
        const aliasVb = ifX?.[idx]?.[18];
        return {
          index: String(indexVb?.value ?? idx),
          name: String(nameVb?.value ?? ''),
          desc: String(aliasVb?.value ?? descrVb?.value ?? ''),
          type: Number(typeVb?.value ?? 0),
        };
      });

      if (!interfaces || interfaces.length === 0) {
        console.log('[SNMP] tableColumns vazio, usando subtree final');
        const [indexRows, nameRows2, aliasRows2, descrRows2, typeRows2] = await withTimeout(
          Promise.all([
            subtree(session, '1.3.6.1.2.1.2.2.1.1').catch(() => []),
            subtree(session, '1.3.6.1.2.1.31.1.1.1.1').catch(() => []),
            subtree(session, '1.3.6.1.2.1.31.1.1.1.18').catch(() => []),
            subtree(session, '1.3.6.1.2.1.2.2.1.2').catch(() => []),
            subtree(session, '1.3.6.1.2.1.2.2.1.3').catch(() => []),
          ]),
          SNMP_GLOBAL_TIMEOUT_MS,
          'SNMP interfaces fallback timeout'
        );

        console.log(`[SNMP] subtree counts: ifIndex=${indexRows.length} ifName=${nameRows2.length} ifAlias=${aliasRows2.length} ifDescr=${descrRows2.length} ifType=${typeRows2.length}`);

        const table = {};
        const addIndex = (idx) => {
          const key = String(idx);
          table[key] = table[key] || { index: key, name: '', desc: '', type: 0 };
        };

        indexRows.forEach((vb) => addIndex(vb.value));
        nameRows2.forEach((vb) => addIndex(oidLastIndex(vb.oid)));
        aliasRows2.forEach((vb) => addIndex(oidLastIndex(vb.oid)));
        descrRows2.forEach((vb) => addIndex(oidLastIndex(vb.oid)));
        typeRows2.forEach((vb) => addIndex(oidLastIndex(vb.oid)));

        nameRows2.forEach((vb) => { const idx = oidLastIndex(vb.oid); table[idx].name = String(vb.value); });
        aliasRows2.forEach((vb) => { const idx = oidLastIndex(vb.oid); table[idx].desc = table[idx].desc || String(vb.value); });
        descrRows2.forEach((vb) => { const idx = oidLastIndex(vb.oid); if (!table[idx].desc) table[idx].desc = String(vb.value); });
        typeRows2.forEach((vb) => { const idx = oidLastIndex(vb.oid); table[idx].type = Number(vb.value); });

        interfaces = Object.values(table);
      }
    }

    console.log(`[SNMP] interfaces: found=${interfaces.length}`);
    res.json({ device: ip, interfaces, count: interfaces.length });
  } catch (err) {
    const message = String(err?.message || err);
    console.error('[SNMP] interfaces error:', message);
    if (message.toLowerCase().includes('timeout')) {
      res.status(504).json({ error: message });
    } else {
      res.status(500).json({ error: message });
    }
  } finally {
    try {
      session.close();
    } catch { }
  }
});

// Descoberta de peers BGP com fallback
app.get('/api/snmp/bgp-peers', async (req, res) => {
  console.log(`[HTTP] ${req.method} ${req.url} query=${JSON.stringify(req.query)}`);
  const ip = req.query.ip;
  const community = req.query.community;
  const port = Number(req.query.port) || 161;

  if (!ip || !community) {
    return res.status(400).json({ error: 'Missing ip or community' });
  }

  const session = snmp.createSession(ip, community, { ...defaultOptions, port });

  try {
    console.log(`[SNMP] bgp-peers: ip=${ip} community=${community} port=${port}`);

    // Read local ASN
    let localAsn = 0;
    try {
      const vb = await withTimeout(
        new Promise((resolve, reject) => {
          session.get(['1.3.6.1.2.1.15.2.0'], (error, varbinds) => {
            if (error) return reject(error);
            resolve(varbinds?.[0]);
          });
        }),
        5000,
        'SNMP local AS timeout'
      );
      localAsn = Number(vb?.value || 0);
    } catch { }

    let table = await withTimeout(
      tableColumns(session, '1.3.6.1.2.1.15.3.1', [7, 9]).then((t) => {
        console.log(`[SNMP] bgpPeerTable rows=${Object.keys(t).length}`);
        return t;
      }),
      SNMP_GLOBAL_TIMEOUT_MS,
      'SNMP bgp-peers timeout'
    ).catch(() => ({}));

    // Try to fetch optional peer description (if MIB supports)
    let descMap = {};
    try {
      const descRows = await subtree(session, '1.3.6.1.2.1.15.3.1.18');
      descRows.forEach((vb) => { descMap[oidLastIndex(vb.oid)] = String(vb.value); });
    } catch { }

    let peers = Object.keys(table).map((idx) => {
      const row = table[idx] || {};
      const addrVb = row[7];
      const asnVb = row[9];
      const asn = Number(asnVb?.value || 0);
      const fallback = asn ? `AS${asn}` : '';
      const name = descMap[idx] || fallback;
      return { ip: bufToIp(addrVb?.value), asn, name };
    }).filter(p => p.ip);

    if (!peers || peers.length === 0) {
      console.log('[SNMP] bgp-peers: tableColumns empty, using subtree fallback');
      const [addrRows, asRows, descRows] = await withTimeout(
        Promise.all([
          subtree(session, '1.3.6.1.2.1.15.3.1.7'),
          subtree(session, '1.3.6.1.2.1.15.3.1.9'),
          subtree(session, '1.3.6.1.2.1.15.3.1.18').catch(() => []),
        ]),
        SNMP_GLOBAL_TIMEOUT_MS,
        'SNMP bgp-peers subtree fallback timeout'
      );

      console.log(`[SNMP] subtree counts: bgpPeerRemoteAddr=${addrRows.length} bgpPeerRemoteAs=${asRows.length}`);

      const asMap = {};
      asRows.forEach((vb) => { asMap[oidLastIndex(vb.oid)] = Number(vb.value); });
      const descMap2 = {};
      (descRows || []).forEach((vb) => { descMap2[oidLastIndex(vb.oid)] = String(vb.value); });

      peers = addrRows.map((vb) => {
        const idx = oidLastIndex(vb.oid);
        const asn = asMap[idx] || 0;
        const fallback = asn ? `AS${asn}` : '';
        const name = descMap2[idx] || fallback;
        return { ip: bufToIp(vb.value), asn, name };
      }).filter(p => p.ip);
    }

    console.log(`[SNMP] bgp-peers: found=${peers.length} localAsn=${localAsn}`);
    res.json({ device: ip, localAsn, peers, count: peers.length });
  } catch (err) {
    const message = String(err?.message || err);
    console.error('[SNMP] bgp-peers error:', message);
    if (message.toLowerCase().includes('timeout')) {
      res.status(504).json({ error: message });
    } else {
      res.status(500).json({ error: message });
    }
  } finally {
    try {
      session.close();
    } catch { }
  }
});

// Ping para validação rápida
app.get('/api/snmp/ping', async (req, res) => {
  const ip = req.query.ip;
  const community = req.query.community;
  const port = Number(req.query.port) || 161;

  if (!ip || !community) {
    return res.status(400).json({ error: 'Missing ip or community' });
  }

  const session = snmp.createSession(ip, community, { ...defaultOptions, port });
  try {
    const vb = await withTimeout(
      new Promise((resolve, reject) => {
        session.get(['1.3.6.1.2.1.1.5.0'], (error, varbinds) => {
          if (error) return reject(error);
          resolve(varbinds?.[0]);
        });
      }),
      5000,
      'SNMP ping timeout'
    );
    res.json({ ok: true, sysName: String(vb?.value || '') });
  } catch (err) {
    const message = String(err?.message || err);
    const code = message.toLowerCase().includes('timeout') ? 504 : 500;
    res.status(code).json({ ok: false, error: message });
  } finally {
    try {
      session.close();
    } catch { }
  }
});

const PORT = process.env.SNMP_SERVER_PORT ?? 3001;
app.listen(PORT, () => {
  console.log(`SNMP server listening on http://localhost:${PORT}`);
});
