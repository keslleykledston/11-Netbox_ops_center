import Fuse from 'fuse.js';

const DEFAULT_THRESHOLD = Number(process.env.JUMPSERVER_FUZZY_THRESHOLD || 0.7);

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractDeviceIp(device) {
  const raw = device?.primary_ip?.address
    || device?.primary_ip4?.address
    || device?.primary_ip6?.address
    || device?.ip
    || device?.ipAddress
    || '';
  if (!raw) return null;
  return String(raw).split('/')[0];
}

export function extractAssetIp(asset) {
  return asset?.ip || asset?.address || asset?.ipv4 || asset?.hostname_ip || null;
}

export function buildAssetIndex(assets, options = {}) {
  return new Fuse(assets, {
    keys: [
      { name: 'name', weight: 0.6 },
      { name: 'hostname', weight: 0.25 },
      { name: 'address', weight: 0.15 },
      { name: 'ip', weight: 0.15 },
    ],
    includeScore: true,
    threshold: options.threshold ?? 0.35,
  });
}

export function findBestMatch(device, assets, { fuse, threshold } = {}) {
  const deviceName = normalizeName(device?.name || device?.display || device?.hostname || '');
  const deviceIp = extractDeviceIp(device);

  if (deviceIp) {
    const ipMatch = assets.find((asset) => {
      const assetIp = extractAssetIp(asset);
      return assetIp && String(assetIp) === String(deviceIp);
    });
    if (ipMatch) {
      return {
        found: ipMatch,
        score: 1.0,
        confidence: 'high',
        reason: 'ip',
      };
    }
  }

  if (!deviceName) {
    return { found: null, score: 0, confidence: 'none', reason: 'name' };
  }

  const localFuse = fuse || buildAssetIndex(assets, { threshold });
  const results = localFuse.search(deviceName);
  if (!results.length) {
    return { found: null, score: 0, confidence: 'none', reason: 'name' };
  }

  const best = results[0];
  const similarity = 1 - (best.score || 1);
  const effectiveThreshold = threshold ?? DEFAULT_THRESHOLD;

  if (similarity >= effectiveThreshold) {
    const confidence = similarity >= 0.85 ? 'high' : 'medium';
    return {
      found: best.item,
      score: similarity,
      confidence,
      reason: 'name',
    };
  }

  return {
    found: null,
    score: similarity,
    confidence: 'low',
    reason: 'name',
  };
}
