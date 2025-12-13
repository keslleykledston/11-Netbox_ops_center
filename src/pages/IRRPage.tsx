import React, { useMemo } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { IRRManager, OpsCenterModuleAPI } from "@/modules/OpsCenterModule";

export default function IRRPage() {
    const apiInstance = useMemo(() => new OpsCenterModuleAPI(), []);

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-foreground">Gerenciador IRR</h1>
                        <p className="text-muted-foreground mt-2">
                            Consulte e submeta objetos RPSL (Routes, ASNs, Maintainers).
                        </p>
                    </div>
                </div>

                <IRRManager apiInstance={apiInstance} />
            </div>
        </DashboardLayout>
    );
}
