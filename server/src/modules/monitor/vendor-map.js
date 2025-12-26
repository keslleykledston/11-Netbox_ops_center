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
    'linux': 'linuxgeneric'
};

export function getOxidizedModel(device) {
    // 1. Tenta usar a plataforma definida no NetBox
    if (device.platform?.slug) {
        // Normaliza alguns slugs comuns do NetBox para Oxidized se necessário
        const slug = device.platform.slug.toLowerCase();
        const platformMap = {
            'mikrotik': 'routeros',
            'routeros': 'routeros',
            'ubiqui': 'airos',
            'ubiquiti': 'airos',
            'airos': 'airos',
            'airfiber': 'airfiber',
            'linux': 'linuxgeneric',
            'linuxgeneric': 'linuxgeneric',
            'linux-generic': 'linuxgeneric',
            'proxmox': 'linuxgeneric',
            'vmware-esxi': 'linuxgeneric',
            'esxi': 'linuxgeneric',
            'vmware': 'linuxgeneric'
        };
        if (platformMap[slug]) return platformMap[slug];
        if (slug.includes('ios')) return 'ios';
        if (slug.includes('junos')) return 'junos';
        if (slug.includes('routeros')) return 'routeros';
        if (slug.includes('ubiqui')) return 'airos';
        if (slug.includes('airfiber')) return 'airfiber';
        if (slug.includes('linux')) return 'linuxgeneric';
        if (slug.includes('proxmox') || slug.includes('vmware') || slug.includes('esxi')) return 'linuxgeneric';
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
