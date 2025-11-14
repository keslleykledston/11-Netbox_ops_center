import * as React from "react";
import { useState, useEffect, useCallback } from 'react';
import { db, Tenant, Client, User, Device, Application } from '@/lib/utils';
import { api } from '@/lib/api';

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

// Hook para Tenants
export function useTenants() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshTenants = useCallback(() => {
    try {
      setLoading(true);
      const data = db.getTenants();
      setTenants(data);
      setError(null);
    } catch (err) {
      setError('Erro ao carregar tenants');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshTenants();
  }, [refreshTenants]);

  const createTenant = useCallback((tenant: Omit<Tenant, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      const newTenant = db.createTenant(tenant);
      refreshTenants();
      return newTenant;
    } catch (err) {
      setError('Erro ao criar tenant');
      throw err;
    }
  }, [refreshTenants]);

  const updateTenant = useCallback((id: string, updates: Partial<Omit<Tenant, 'id' | 'createdAt'>>) => {
    try {
      const updated = db.updateTenant(id, updates);
      if (updated) {
        refreshTenants();
      }
      return updated;
    } catch (err) {
      setError('Erro ao atualizar tenant');
      throw err;
    }
  }, [refreshTenants]);

  const deleteTenant = useCallback((id: string) => {
    try {
      const success = db.deleteTenant(id);
      if (success) {
        refreshTenants();
      }
      return success;
    } catch (err) {
      setError('Erro ao deletar tenant');
      throw err;
    }
  }, [refreshTenants]);

  return {
    tenants,
    loading,
    error,
    createTenant,
    updateTenant,
    deleteTenant,
    refreshTenants
  };
}

// Hook para Devices
const API_MODE = import.meta.env.VITE_USE_BACKEND === "true";

export function useDevices(tenantId?: string) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      setLoading(true);
      if (API_MODE) {
        const list = await api.listDevices(tenantId);
        setDevices(list as unknown as Device[]);
      } else {
        const data = db.getDevices(tenantId);
        setDevices(data);
      }
      setError(null);
    } catch (err) {
      setError('Erro ao carregar dispositivos');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  const createDevice = useCallback(async (device: Omit<Device, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      if (API_MODE) {
        const created = await api.createDevice({
          tenantId: device.tenantId,
          name: device.name,
          hostname: device.hostname,
          ipAddress: device.ipAddress,
          deviceType: device.deviceType,
          manufacturer: device.manufacturer,
          model: device.model,
          status: device.status,
          snmpVersion: device.snmpVersion,
          snmpCommunity: device.snmpCommunity,
          snmpPort: device.snmpPort,
        });
        await refreshDevices();
        return created as unknown as Device;
      }
      const newDevice = db.createDevice(device);
      refreshDevices();
      return newDevice;
    } catch (err) {
      setError('Erro ao criar dispositivo');
      throw err;
    }
  }, [refreshDevices]);

  const updateDevice = useCallback(async (id: string, updates: Partial<Omit<Device, 'id' | 'createdAt'>>) => {
    try {
      if (API_MODE) {
        const updated = await api.updateDevice(id, updates);
        await refreshDevices();
        return updated as unknown as Device;
      }
      const updated = db.updateDevice(id, updates);
      if (updated) {
        refreshDevices();
      }
      return updated;
    } catch (err) {
      setError('Erro ao atualizar dispositivo');
      throw err;
    }
  }, [refreshDevices]);

  const deleteDevice = useCallback((id: string) => {
    try {
      if (API_MODE) {
        return api.deleteDevice(id).then(() => { refreshDevices(); return true; }).catch(() => false);
      }
      const success = db.deleteDevice(id);
      if (success) {
        refreshDevices();
      }
      return success;
    } catch (err) {
      setError('Erro ao deletar dispositivo');
      throw err;
    }
  }, [refreshDevices]);

  return {
    devices,
    loading,
    error,
    createDevice,
    updateDevice,
    deleteDevice,
    refreshDevices
  };
}

// Hook para Applications
export function useApplications(tenantId?: string) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshApplications = useCallback(async () => {
    try {
      setLoading(true);
      if (API_MODE) {
        const list = await api.listApplications();
        setApplications(list as unknown as Application[]);
      } else {
        const data = db.getApplications(tenantId);
        setApplications(data);
      }
      setError(null);
    } catch (err) {
      setError('Erro ao carregar aplicações');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    refreshApplications();
  }, [refreshApplications]);

  const createApplication = useCallback((application: Omit<Application, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      if (API_MODE) {
        return api.createApplication({
          name: application.name,
          url: application.url,
          apiKey: application.apiKey,
          status: application.status,
          description: application.description,
        }).then((created) => { refreshApplications(); return created as unknown as Application; });
      }
      const newApplication = db.createApplication(application);
      refreshApplications();
      return newApplication;
    } catch (err) {
      setError('Erro ao criar aplicação');
      throw err;
    }
  }, [refreshApplications]);

  const updateApplication = useCallback(async (id: string, updates: Partial<Omit<Application, 'id' | 'createdAt'>>) => {
    try {
      if (API_MODE) {
        const updated = await api.updateApplication(id, updates);
        await refreshApplications();
        return updated as unknown as Application;
      }
      const updated = db.updateApplication(id, updates);
      if (updated) {
        refreshApplications();
      }
      return updated;
    } catch (err) {
      setError('Erro ao atualizar aplicação');
      throw err;
    }
  }, [refreshApplications]);

  const deleteApplication = useCallback((id: string) => {
    try {
      const success = db.deleteApplication(id);
      if (success) {
        refreshApplications();
      }
      return success;
    } catch (err) {
      setError('Erro ao deletar aplicação');
      throw err;
    }
  }, [refreshApplications]);

  return {
    applications,
    loading,
    error,
    createApplication,
    updateApplication,
    deleteApplication,
    refreshApplications
  };
}
