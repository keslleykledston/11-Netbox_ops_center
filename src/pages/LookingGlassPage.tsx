import React, { useMemo } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { LookingGlass, OpsCenterModuleAPI } from "@/modules/OpsCenterModule";

export default function LookingGlassPage() {
    const apiInstance = useMemo(() => new OpsCenterModuleAPI(), []);

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-foreground">Looking Glass</h1>
                        <p className="text-muted-foreground mt-2">
                            Consulte rotas BGP e informações de conectividade em tempo real.
                        </p>
                    </div>
                </div>

                <LookingGlass apiInstance={apiInstance} />
            </div>
        </DashboardLayout>
    );
}
