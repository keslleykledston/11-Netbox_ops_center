// Mapeamento de fabricante (NetBox slug) para driver do Oxidized
export const VENDOR_MAP = {
    'huawei': 'vrp',
    'cisco': 'ios',
    'juniper': 'junos',
    'mikrotik': 'routeros',
    'datacom': 'dmos', // Assumindo DmOS para Datacom modernos
    'hp': 'procurve',
    'arista': 'eos',
    'dell': 'dnos',
    'extreme-networks': 'xos',
    'fortinet': 'fortios',
    'paloalto': 'panos',
    'ubiquiti': 'airos',
    'zte': 'zte',
    'fiberhome': 'fiberhome',
    'vyos': 'vyos',
    'linux': 'linux'
};

export function getOxidizedModel(device) {
    // 1. Tenta usar a plataforma definida no NetBox
    if (device.platform?.slug) {
        // Normaliza alguns slugs comuns do NetBox para Oxidized se necessário
        const slug = device.platform.slug.toLowerCase();
        if (slug.includes('ios')) return 'ios';
        if (slug.includes('junos')) return 'junos';
        if (slug.includes('routeros')) return 'routeros';
        return slug;
    }

    // 2. Tenta inferir pelo fabricante
    const manufacturer = device.device_type?.manufacturer?.slug?.toLowerCase();
    if (manufacturer && VENDOR_MAP[manufacturer]) {
        return VENDOR_MAP[manufacturer];
    }

    // 3. Fallback
    return 'routeros'; // Default seguro ou 'unknown'
}
