import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export interface ServiceHealth {
    status: 'ok' | 'error' | 'unknown';
    port?: number;
    workers?: number;
}

export interface HealthData {
    overall: 'healthy' | 'unhealthy';
    services: {
        api: ServiceHealth;
        snmp: ServiceHealth;
        redis: ServiceHealth;
        database: ServiceHealth;
        queues: ServiceHealth;
    };
    timestamp: string;
}

export function useServiceHealth(intervalMs = 30000) {
    const [health, setHealth] = useState<HealthData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchHealth = async () => {
            try {
                const data = await api.getServiceHealth();
                setHealth(data);
                setError(null);
            } catch (err: any) {
                setError(err?.message || 'Failed to fetch health');
            } finally {
                setLoading(false);
            }
        };

        fetchHealth();
        const interval = setInterval(fetchHealth, intervalMs);

        return () => clearInterval(interval);
    }, [intervalMs]);

    return { health, loading, error };
}
